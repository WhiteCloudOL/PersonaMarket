import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  RankingListResponseSchema,
  SubmissionResponseSchema,
  PublicPersonaListResponseSchema,
  RANKING_ALGORITHM,
  RankingPlatformSchema,
  rankingBoardCombinations,
} from '@personamarket/contracts';
import { createTestDatabaseOwner } from '@personamarket/database';
import {
  PublicSitemapIndexResponseSchema,
  PublicSitemapEntriesResponseSchema,
} from '@personamarket/contracts';
import {
  enqueueRankingRefresh,
  rankingCalculationSql,
  rankingCalculationGroups,
} from '@personamarket/server';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { buildPublicSitemapEntriesQuery } from '@personamarket/api/testing';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import { seedSearchLoad } from '../fixtures/search-load.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
const measurements: Array<{ operation: string; milliseconds: number }> = [];
const templates: Array<{ id: string; platform: 'maibot' | 'astrbot' }> = [];
const workerResults: Array<{ event: string; elapsedMs: number; code?: string; message?: string }> =
  [];
let rebuildStarted = 0;

beforeAll(async () => {
  stack = await createAuthStack();
  stack.worker.on('failed', (job, cause) => {
    if (job?.name !== 'rankings.refresh') return;
    let leaf: unknown = cause;
    for (let depth = 0; depth < 6 && leaf instanceof Error && leaf.cause; depth++)
      leaf = leaf.cause;
    workerResults.push({
      event: 'failed',
      elapsedMs: Math.round(performance.now() - rebuildStarted),
      ...(leaf instanceof Error && 'code' in leaf && typeof leaf.code === 'string'
        ? { code: leaf.code }
        : {}),
      ...(leaf instanceof Error ? { message: leaf.message.slice(0, 160) } : {}),
    });
  });
  stack.worker.on('completed', (job) => {
    if (job.name === 'rankings.refresh')
      workerResults.push({
        event: 'completed',
        elapsedMs: Math.round(performance.now() - rebuildStarted),
      });
  });
  const author = await verifiedCreator(stack);
  const admin = await stack.admin();
  for (const platform of ['maibot', 'astrbot'] as const) {
    const persona = await completePersona(author.http, platform);
    const response = await author.http.write(
      '/api/v1/me/personas/' + persona.id + '/releases',
      {
        version: '1.0.0',
        expectedDraftRevision: persona.revision,
        changelog: '隔离容量样本基准',
        confirmed: true,
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(response.status).toBe(200);
    const submission = SubmissionResponseSchema.parse(await response.json()).data;
    expect(
      (
        await admin.http.write(
          '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
          {
            action: 'approve',
            expectedRevision: 1,
            reason: '核验容量基准来源',
            selfReviewConfirmed: false,
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(200);
    // 两个平台分别由真实导出得到2和1个去重主体，再复制到隔离数据库容量样本
    for (let index = 0; index < (platform === 'maibot' ? 2 : 1); index++) {
      const exported = await stack
        .browser()
        .raw(
          '/api/v1/personas/' +
            persona.id +
            '/releases/' +
            submission.releaseId +
            '/export?format=text',
        );
      expect(exported.status).toBe(200);
      await exported.arrayBuffer();
    }
    templates.push({ id: persona.id, platform });
  }
});
// 各平台的批量准备串行且各自受默认30秒约束，不与业务计时或数据库重启混在一起
for (const platform of ['maibot', 'astrbot'] as const)
  beforeAll(async () => {
    const persona = templates.find((item) => item.platform === platform);
    if (!persona) throw new Error('缺少真实平台容量基准');
    const client = await stack.owner.pool.connect();
    try {
      for (let batch = 0; batch < 5; batch++) await seedSearchLoad(client, persona.id, 1000);
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO export_subject_days(persona_id,day,subject_hash,ranking_eligible,created_at)
          SELECT p.id,e.day,e.subject_hash,e.ranking_eligible,e.created_at
          FROM personas p CROSS JOIN export_subject_days e
          WHERE p.platform=$1 AND p.id<>$2 AND e.persona_id=$2`,
          [platform, persona.id],
        );
        await client.query(
          `INSERT INTO export_daily_metrics(persona_id,day,total_count,ranking_count)
          SELECT p.id,e.day,e.total_count,e.ranking_count FROM personas p CROSS JOIN export_daily_metrics e
          WHERE p.platform=$1 AND p.id<>$2 AND e.persona_id=$2`,
          [platform, persona.id],
        );
        await client.query(
          `INSERT INTO export_version_subject_days(persona_id,release_id,day,format,subject_hash)
          SELECT p.id,p.published_release_id,e.day,e.format,e.subject_hash
          FROM personas p CROSS JOIN export_version_subject_days e
          WHERE p.platform=$1 AND p.id<>$2 AND e.persona_id=$2`,
          [platform, persona.id],
        );
        await client.query(
          `INSERT INTO export_version_daily_metrics(persona_id,release_id,day,format,total_count,ranking_count)
          SELECT p.id,p.published_release_id,e.day,e.format,e.total_count,e.ranking_count
          FROM personas p CROSS JOIN export_version_daily_metrics e
          WHERE p.platform=$1 AND p.id<>$2 AND e.persona_id=$2`,
          [platform, persona.id],
        );
        await client.query('COMMIT');
      } catch (cause) {
        await client.query('ROLLBACK');
        throw cause;
      }
    } finally {
      client.release();
    }
  });
beforeAll(async () => {
  for (const table of [
    'personas',
    'persona_releases',
    'release_submissions',
    'export_subject_days',
    'export_daily_metrics',
  ])
    await stack.owner.pool.query('ANALYZE ' + table);
});
afterAll(async () => {
  try {
    await stack?.worker.close();
    await mkdir('data/tests/rankings', { recursive: true });
    await writeFile(
      'data/tests/rankings/worker-diagnostic.json',
      JSON.stringify(workerResults, null, 2),
    );
    if (workerResults.some((row) => row.code === '57014')) await diagnoseTimedOutCalculation();
  } finally {
    await stack?.close();
  }
});

/** 只在容量失败后对本进程隔离库执行回滚EXPLAIN；业务池5秒和原测试门禁不变 */
async function diagnoseTimedOutCalculation() {
  const current = (
    await stack.owner.pool.query<{ name: string }>('SELECT current_database() AS name')
  ).rows[0]?.name;
  if (
    !current ||
    !/^pm_auth_case_[a-f0-9]{32}_test$/.test(current) ||
    !process.env['TEST_DATABASE_URL']
  )
    throw Error('拒绝对非本轮隔离库采集写入执行计划');
  const url = new URL(process.env['TEST_DATABASE_URL']);
  url.pathname = '/' + current;
  const diagnostic = createTestDatabaseOwner(url.href),
    client = await diagnostic.pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const id = randomUUID();
    await client.query(
      'INSERT INTO ranking_generations(id,request_key,algorithm) VALUES($1,$2,$3)',
      [id, 'diagnostic:' + id, RANKING_ALGORITHM],
    );
    const dimensions = rankingBoardCombinations(RANKING_ALGORITHM).flatMap(({ kind, window }) =>
      RankingPlatformSchema.options.map((platform) => ({ kind, window, platform })),
    );
    await client.query(
      'INSERT INTO ranking_boards(generation_id,kind,"window",platform,entry_count,capped) SELECT $1::uuid,b.kind,b."window",b.platform,0,false FROM jsonb_to_recordset($2::jsonb) AS b(kind text,"window" text,platform text)',
      [id, JSON.stringify(dimensions)],
    );
    const at = (await client.query<{ at: Date }>('SELECT transaction_timestamp() AS at')).rows[0]
      ?.at;
    if (!at) throw Error('缺少诊断时刻');
    const plans = [];
    for (const kinds of rankingCalculationGroups) {
      const query = new PgDialect().sqlToQuery(rankingCalculationSql(id, at, kinds));
      const plan = await client.query(
        'EXPLAIN (ANALYZE,BUFFERS,SETTINGS,FORMAT JSON) ' + query.sql,
        query.params,
      );
      plans.push({ kinds, plan: plan.rows });
    }
    await writeFile(
      'data/tests/rankings/calculation-failed-actual-plan.json',
      JSON.stringify(
        {
          purpose: 'isolated rollback diagnostic; does not change business timeout',
          plans,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await diagnostic.close();
    }
  }
}

async function rebuild(timeout = 5000) {
  const start = performance.now();
  rebuildStarted = start;
  const id = await enqueueRankingRefresh(stack.owner, 'manual');
  if (!id) throw new Error('缺少容量重建请求');
  const plans = [];
  for (const kinds of rankingCalculationGroups)
    plans.push({
      kinds,
      plan: (
        await stack.owner.db.execute(
          sql`EXPLAIN (FORMAT JSON) ${rankingCalculationSql(id, new Date(), kinds)}`,
        )
      ).rows,
    });
  await mkdir('data/tests/rankings', { recursive: true });
  await writeFile('data/tests/rankings/calculation-plan.json', JSON.stringify(plans, null, 2));
  await stack.tick();
  await expect
    .poll(
      async () =>
        (await stack.owner.pool.query('SELECT status FROM ranking_generations WHERE id=$1', [id]))
          .rows[0]?.status,
      { timeout, interval: 100 },
    )
    .toBe('completed');
  measurements.push({ operation: 'rebuild', milliseconds: Math.round(performance.now() - start) });
  return id;
}
async function list(id: string, platform: string, page = 1) {
  const start = performance.now();
  const response = await stack.browser().raw(
    '/api/v1/rankings?' +
      new URLSearchParams({
        kind: 'downloads',
        window: 'all',
        snapshotId: id,
        platform,
        page: String(page),
      }),
  );
  expect(response.status).toBe(200);
  measurements.push({
    operation: 'read:' + platform + ':' + page,
    milliseconds: Math.round(performance.now() - start),
  });
  return RankingListResponseSchema.parse(await response.json());
}

it('一万真实约束样本独立截取每个平台前1000项，同分稳定分页且批次结果有界', async () => {
  const sample = await stack.owner.pool.query('SELECT count(*)::integer AS total FROM personas');
  expect(sample.rows[0]?.total).toBe(10002);
  const id = await rebuild();
  const boards = await stack.owner.pool.query(
    'SELECT kind,entry_count,capped FROM ranking_boards WHERE generation_id=$1',
    [id],
  );
  expect(boards.rowCount).toBe(36);
  const originalBoards = boards.rows.filter(
    (row) => row.kind !== 'likes' && row.kind !== 'favorites',
  );
  const socialBoards = boards.rows.filter(
    (row) => row.kind === 'likes' || row.kind === 'favorites',
  );
  expect(originalBoards).toHaveLength(18);
  expect(originalBoards.every((row) => row.entry_count === 1000 && row.capped)).toBe(true);
  expect(socialBoards).toHaveLength(18);
  expect(socialBoards.every((row) => row.entry_count === 0 && !row.capped)).toBe(true);
  expect(
    (
      await stack.owner.pool.query(
        'SELECT count(*)::integer AS total FROM ranking_entries WHERE generation_id=$1',
        [id],
      )
    ).rows[0]?.total,
  ).toBe(18000);
  const all = await list(id, 'all');
  expect(all.meta).toMatchObject({ total: 1000, limited: true });
  expect(all.data.every((row) => row.snapshot.platform === 'maibot')).toBe(true);
  const astr = await list(id, 'astrbot');
  expect(astr.meta).toMatchObject({ total: 1000, limited: true });
  expect(astr.data.every((row) => row.snapshot.platform === 'astrbot')).toBe(true);
  const second = await list(id, 'astrbot', 2);
  expect(new Set([...astr.data, ...second.data].map((row) => row.personaId)).size).toBe(40);
  const last = await list(id, 'astrbot', 50);
  expect(last.data.map((row) => row.position)).toEqual(
    Array.from({ length: 20 }, (_, i) => 981 + i),
  );
  const expected = await stack.owner.pool.query<{ id: string }>(
    "SELECT id FROM personas WHERE platform='astrbot' ORDER BY first_published_at DESC,id DESC LIMIT 20",
  );
  expect(astr.data.map((row) => row.personaId)).toEqual(expected.rows.map((row) => row.id));
  const next = await list(await rebuild(), 'astrbot');
  expect(next.data.map((row) => row.personaId)).toEqual(astr.data.map((row) => row.personaId));
  const plan = await stack.owner.pool.query(
    `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT position,persona_id FROM ranking_entries
    WHERE generation_id=$1 AND kind='downloads' AND "window"='all' AND platform='astrbot'
    ORDER BY position LIMIT 20`,
    [id],
  );
  await mkdir('data/tests/rankings', { recursive: true });
  await writeFile(
    'data/tests/rankings/performance.json',
    JSON.stringify({ sampleSize: 10002, measurements, readPlan: plan.rows }, null, 2),
  );
});

it('站点地图分片覆盖10002项全部当前作品，不受探索与排行榜1000项展示上限截断', async () => {
  const indexResponse = await stack.browser().raw('/api/v1/public/sitemap/index');
  expect(indexResponse.status).toBe(200);
  const index = PublicSitemapIndexResponseSchema.parse(await indexResponse.json()).data;
  expect(index).toEqual({ total: 10002, pageSize: 1000, pages: 11 });
  const ids: string[] = [];
  const timings: Array<{ page: number; milliseconds: number }> = [];
  for (let page = 1; page <= index.pages; page++) {
    const started = performance.now();
    const response = await stack.browser().raw('/api/v1/public/sitemap/entries?page=' + page);
    timings.push({ page, milliseconds: Math.round(performance.now() - started) });
    if (response.status !== 200) {
      const query = buildPublicSitemapEntriesQuery(stack.owner.db, page).toSQL();
      const planner = await stack.owner.pool.connect();
      let estimated: unknown;
      let actual: unknown;
      try {
        await planner.query('BEGIN READ ONLY');
        await planner.query("SET LOCAL statement_timeout='5s'");
        estimated = (await planner.query('EXPLAIN (FORMAT JSON) ' + query.sql, query.params)).rows;
        try {
          actual = (
            await planner.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + query.sql, query.params)
          ).rows;
        } catch (cause) {
          actual = { code: cause instanceof Error && 'code' in cause ? cause.code : 'UNKNOWN' };
        }
      } finally {
        await planner.query('ROLLBACK');
        planner.release();
      }
      await mkdir('data/tests/seo', { recursive: true });
      await writeFile(
        'data/tests/seo/sitemap-failed-plan-' + Date.now() + '.json',
        JSON.stringify(
          { page, timings, response: await response.json(), query, estimated, actual },
          null,
          2,
        ),
      );
    }
    expect(response.status, '站点地图分片 ' + page).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const rows = PublicSitemapEntriesResponseSchema.parse(await response.json()).data;
    expect(rows).toHaveLength(page === 11 ? 2 : 1000);
    ids.push(...rows.map((row) => row.personaId));
  }
  expect(new Set(ids).size).toBe(10002);
  expect(ids).toEqual([...ids].sort());
  const expected = await stack.owner.pool.query<{ id: string }>(
    'SELECT id FROM personas ORDER BY id',
  );
  expect(ids).toEqual(expected.rows.map((row) => row.id));
  const planner = await stack.owner.pool.connect();
  const plans: unknown[] = [];
  try {
    await planner.query('BEGIN READ ONLY');
    await planner.query("SET LOCAL statement_timeout='2s'");
    for (const page of [4, 11]) {
      const query = buildPublicSitemapEntriesQuery(stack.owner.db, page).toSQL();
      plans.push({
        page,
        plan: (
          await planner.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + query.sql, query.params)
        ).rows,
      });
    }
  } finally {
    await planner.query('ROLLBACK');
    planner.release();
  }
  await mkdir('data/tests/seo', { recursive: true });
  await writeFile(
    'data/tests/seo/sitemap-performance.json',
    JSON.stringify({ sampleSize: 10002, pages: index.pages, timings, plans }, null, 2),
  );
});

it('10002项探索有效导出排序读取完整候选，平台筛选与稳定分页不受排行榜前1000项截断', async () => {
  const timings: Array<{ sort: string; platform: string; page: number; milliseconds: number }> = [];
  const read = async (sort: string, platform = '', page = 1) => {
    const start = performance.now();
    const response = await stack
      .browser()
      .raw(
        '/api/v1/personas?' +
          new URLSearchParams({ sort, ...(platform ? { platform } : {}), page: String(page) }),
      );
    timings.push({ sort, platform, page, milliseconds: Math.round(performance.now() - start) });
    expect(response.status).toBe(200);
    return PublicPersonaListResponseSchema.parse(await response.json());
  };
  for (const sort of ['downloads', 'recent-downloads', 'hot']) {
    const all = await read(sort);
    expect(all.meta).toMatchObject({ total: 10002, capped: false });
    expect(
      all.data.every(
        (row) =>
          row.snapshot.platform === 'maibot' &&
          (row.exportMetric ?? row.heatMetric)?.eligibleExports === 2,
      ),
    ).toBe(true);
    const astr = await read(sort, 'astrbot');
    expect(astr.meta).toMatchObject({ total: 5001, capped: false });
    expect(
      astr.data.every(
        (row) =>
          row.snapshot.platform === 'astrbot' &&
          (row.exportMetric ?? row.heatMetric)?.eligibleExports === 1,
      ),
    ).toBe(true);
    const second = await read(sort, 'astrbot', 2);
    expect(new Set([...astr.data, ...second.data].map((row) => row.personaId)).size).toBe(40);
    const expected = await stack.owner.pool.query<{ id: string }>(
      "SELECT id FROM personas WHERE platform='astrbot' ORDER BY first_published_at DESC,id DESC LIMIT 20",
    );
    expect(astr.data.map((row) => row.personaId)).toEqual(expected.rows.map((row) => row.id));
    const filtered = await stack
      .browser()
      .raw(
        '/api/v1/personas?' +
          new URLSearchParams({ sort, q: 'benchmark-token-rare', platform: 'astrbot' }),
      );
    expect(filtered.status).toBe(200);
    const searched = PublicPersonaListResponseSchema.parse(await filtered.json());
    expect(searched.meta.total).toBeGreaterThan(0);
    expect(
      searched.data.every((row) => (row.exportMetric ?? row.heatMetric)?.eligibleExports === 1),
    ).toBe(true);
  }
  await mkdir('data/tests/discovery-popularity', { recursive: true });
  await writeFile(
    'data/tests/discovery-popularity/performance.json',
    JSON.stringify({ sampleSize: 10002, timings }, null, 2),
  );
});

describe('10002项作品与30006条真实关系模板的互动容量', () => {
  beforeAll(async () => {
    const reader = await verifiedCreator(stack),
      second = await verifiedCreator(stack);
    for (const template of templates) {
      for (const kind of ['like', 'favorite']) {
        expect(
          (await reader.http.write('/api/v1/personas/' + template.id + '/' + kind, {}, 'PUT'))
            .status,
        ).toBe(200);
        if (template.platform === 'maibot')
          expect(
            (await second.http.write('/api/v1/personas/' + template.id + '/' + kind, {}, 'PUT'))
              .status,
          ).toBe(200);
      }
      // 容量样本复制真实关系模板，所有约束保持启用；不用于运营展示或截图
      for (const table of ['persona_likes', 'persona_favorites'])
        await stack.owner.pool.query(
          'INSERT INTO ' +
            table +
            '(persona_id,user_id,active,first_added_at,updated_at) ' +
            'SELECT p.id,r.user_id,r.active,r.first_added_at,r.updated_at FROM personas p CROSS JOIN ' +
            table +
            ' r WHERE p.platform=$1 AND p.id<>$2 AND r.persona_id=$2',
          [template.platform, template.id],
        );
    }
    for (const table of ['persona_likes', 'persona_favorites']) {
      expect(
        (
          await stack.owner.pool.query<{ total: number }>(
            'SELECT count(*)::int AS total FROM ' + table,
          )
        ).rows[0]?.total,
      ).toBe(15003);
      await stack.owner.pool.query('ANALYZE ' + table);
    }
  });
  it('两个有界SQL在同一事务生成全部互动榜，探索复用实际关系并在查询预算内返回', async () => {
    // 每条SQL仍受生产5秒限制；36板后台整批包含两组写入，专用容量门禁为10秒
    const id = await rebuild(10000);
    const boards = await stack.owner.pool.query<{ entry_count: number; capped: boolean }>(
      'SELECT entry_count,capped FROM ranking_boards WHERE generation_id=$1',
      [id],
    );
    expect(boards.rowCount).toBe(36);
    expect(boards.rows.every((row) => row.entry_count === 1000 && row.capped)).toBe(true);
    expect(
      (
        await stack.owner.pool.query<{ total: number }>(
          'SELECT count(*)::int AS total FROM ranking_entries WHERE generation_id=$1',
          [id],
        )
      ).rows[0]?.total,
    ).toBe(36000);
    for (const [kind, window, platform, expected] of [
      ['likes', 'all', 'all', 2],
      ['favorites', '7d', 'all', 2],
      ['likes', '30d', 'astrbot', 1],
      ['favorites', 'all', 'astrbot', 1],
    ] as const) {
      const response = await stack
        .browser()
        .raw(
          `/api/v1/rankings?snapshotId=${id}&kind=${kind}&window=${window}&platform=${platform}`,
        );
      expect(response.status).toBe(200);
      const value = RankingListResponseSchema.parse(await response.json());
      expect(value.meta).toMatchObject({
        total: 1000,
        limited: true,
        algorithm: 'interactions-v1',
      });
      expect(value.data).toHaveLength(20);
      expect(value.data.every((row) => row.score === expected)).toBe(true);
      expect(new Set(value.data.map((row) => row.personaId)).size).toBe(20);
    }
    const timings = [];
    for (const sort of ['hot', 'likes', 'favorites'] as const)
      for (const [platform, expected] of [
        ['', 2],
        ['astrbot', 1],
      ] as const) {
        const started = performance.now();
        const response = await stack
          .browser()
          .raw('/api/v1/personas?sort=' + sort + (platform ? '&platform=' + platform : ''));
        timings.push({ sort, platform, milliseconds: Math.round(performance.now() - started) });
        expect(response.status).toBe(200);
        const value = PublicPersonaListResponseSchema.parse(await response.json());
        expect(value.meta).toMatchObject({ total: platform ? 5001 : 10002, capped: false });
        expect(
          value.data.every((row) =>
            sort === 'hot'
              ? row.heatMetric?.algorithm === 'interactions-v1' &&
                row.heatMetric.eligibleLikes === expected &&
                row.heatMetric.eligibleFavorites === expected &&
                row.heatMetric.eligibleExports === expected
              : row.interactionMetric?.kind === sort &&
                row.interactionMetric.eligibleCount === expected,
          ),
        ).toBe(true);
      }
    await writeFile(
      'data/tests/rankings/interaction-performance.json',
      JSON.stringify({ sampleSize: 10002, relationCount: 30006, measurements, timings }, null, 2),
    );
  });
});
