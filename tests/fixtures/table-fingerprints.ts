import type { Database } from '@personamarket/database';
import assert from 'node:assert/strict';
import { defaultHomeSettings, defaultModelSuggestions } from '@personamarket/contracts';

export type TableShape = Record<string, string[]>;

/** 固定升级前的字段集合，新增列仍由专项断言检查，原有字段不得被改写 */
export async function captureTableShape(database: Database): Promise<TableShape> {
  const columns = await database.pool.query<{ table_name: string; column_name: string }>(
    "SELECT c.table_name,c.column_name FROM information_schema.columns c JOIN pg_tables t ON t.schemaname=c.table_schema AND t.tablename=c.table_name WHERE c.table_schema='public' ORDER BY c.table_name,c.ordinal_position",
  );
  const result: TableShape = {};
  for (const column of columns.rows) (result[column.table_name] ??= []).push(column.column_name);
  return result;
}

export async function tableFingerprints(
  database: Database,
  shape: TableShape,
  options?: { expectedNewHomeSetting?: true; expectedNewModelSuggestions?: true },
) {
  const seeds = [
    ...(options?.expectedNewHomeSetting ? [{ key: 'home', value: defaultHomeSettings }] : []),
    ...(options?.expectedNewModelSuggestions
      ? [{ key: 'modelSuggestions', value: defaultModelSuggestions }]
      : []),
  ];
  for (const seed of seeds) {
    const seeded = await database.pool.query<{
      value: unknown;
      revision: number;
      updated_at: Date;
    }>('SELECT value,revision,updated_at FROM site_settings WHERE key=$1', [seed.key]);
    assert.equal(seeded.rowCount, 1, '迁移必须准确增加唯一默认设置：' + seed.key);
    const row = seeded.rows[0];
    assert.ok(row);
    assert.deepEqual(row.value, seed.value);
    assert.equal(row.revision, 1);
    assert.ok(row.updated_at instanceof Date && Number.isFinite(row.updated_at.getTime()));
  }
  const fingerprints: Record<string, string> = {};
  for (const [table, columns] of Object.entries(shape)) {
    if (!/^[a-z][a-z0-9_]*$/.test(table) || !columns.length)
      throw new Error('未捕获有效的测试表结构');
    // 允许增加的新设置行先逐条完整核验，旧设置和其它表的全部记录仍参与原字段指纹
    const omitExpectedSeed = seeds.length > 0 && table === 'site_settings';
    const result = await database.pool.query<{ fingerprint: string }>(
      `SELECT md5(COALESCE(jsonb_agg(filtered ORDER BY filtered::text),'[]'::jsonb)::text) AS fingerprint
       FROM (SELECT (SELECT jsonb_object_agg(field.key,field.value) FROM jsonb_each(to_jsonb(r)) field WHERE field.key=ANY($1::text[])) AS filtered FROM public."${table}" r ${omitExpectedSeed ? 'WHERE r.key <> ALL($2::text[])' : ''}) saved`,
      omitExpectedSeed ? [columns, seeds.map((seed) => seed.key)] : [columns],
    );
    const fingerprint = result.rows[0]?.fingerprint;
    if (!fingerprint) throw new Error('未读到测试数据指纹');
    fingerprints[table] = fingerprint;
  }
  return fingerprints;
}
