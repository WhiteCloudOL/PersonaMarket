import type { Database } from '@personamarket/database';
/** 预览是短期私有状态，分批清理避免长事务；确认事务持锁时跳过该行 */
export async function pruneImportPreviews(database: Database) {
  const result = await database.pool.query(`DELETE FROM persona_imports WHERE id IN (
    SELECT id FROM persona_imports WHERE expires_at<=now() ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT 100
  )`);
  return result.rowCount ?? 0;
}
