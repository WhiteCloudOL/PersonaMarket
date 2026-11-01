import type { Database } from '@personamarket/database';

/** 只保留35天匿名去重摘要；长期日汇总无主体数据，清理不会减少已提交计数 */
export async function pruneExportSubjects(database: Database) {
  const subjects = await database.pool
    .query(`DELETE FROM export_subject_days WHERE (persona_id,day,subject_hash) IN (
    SELECT persona_id,day,subject_hash FROM export_subject_days
    WHERE day <= (now() AT TIME ZONE 'UTC')::date-35 ORDER BY day,persona_id,subject_hash FOR UPDATE SKIP LOCKED LIMIT 500
  )`);
  const versions = await database.pool
    .query(`DELETE FROM export_version_subject_days WHERE (release_id,day,format,subject_hash) IN (
    SELECT release_id,day,format,subject_hash FROM export_version_subject_days
    WHERE day <= (now() AT TIME ZONE 'UTC')::date-35 ORDER BY day,release_id,format,subject_hash FOR UPDATE SKIP LOCKED LIMIT 500
  )`);
  return (subjects.rowCount ?? 0) + (versions.rowCount ?? 0);
}
