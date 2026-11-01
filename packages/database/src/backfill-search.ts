import type { PoolClient } from 'pg';
import { buildPublicSearchProjection } from '@personamarket/persona-adapters';

/** 在迁移锁内执行，可从已完成的批次继续；原始Submission内容保持不变 */
export async function backfillPublicSearch(client: PoolClient) {
  await client.query(`UPDATE personas p SET first_published_at=history.first_at
    FROM (SELECT persona_id,min(published_at) AS first_at FROM persona_releases
      WHERE published_at IS NOT NULL GROUP BY persona_id) history
    WHERE p.id=history.persona_id AND p.first_published_at IS NULL`);
  await client.query(`INSERT INTO persona_public_projection(persona_id,release_id,title,summary,readme_text)
    SELECT p.id,r.id,s.snapshot->>'title',s.snapshot->>'summary',s.snapshot->>'readmeMarkdown'
    FROM personas p JOIN persona_releases r ON r.id=p.published_release_id AND r.persona_id=p.id
    JOIN release_submissions s ON s.id=r.approved_submission_id AND s.persona_id=p.id AND s.release_id=r.id
    WHERE s.status='APPROVED' AND r.published_at IS NOT NULL
    ON CONFLICT(persona_id) DO UPDATE SET release_id=excluded.release_id
    WHERE persona_public_projection.release_id IS DISTINCT FROM excluded.release_id`);
  for (;;) {
    await client.query('BEGIN');
    try {
      await client.query("SET LOCAL statement_timeout='15s'");
      const pending = await client.query<{
        persona_id: string;
        release_id: string;
        snapshot: unknown;
        publication: unknown;
      }>(`SELECT p.persona_id,p.release_id,s.snapshot,s.publication
        FROM persona_public_projection p JOIN persona_releases r ON r.id=p.release_id AND r.persona_id=p.persona_id
        JOIN release_submissions s ON s.id=r.approved_submission_id AND s.persona_id=p.persona_id AND s.release_id=r.id
        WHERE p.search_release_id IS DISTINCT FROM p.release_id AND s.status='APPROVED' AND r.published_at IS NOT NULL
        ORDER BY p.persona_id LIMIT 100 FOR UPDATE OF p`);
      for (const row of pending.rows) {
        const fields = buildPublicSearchProjection(row.snapshot, row.publication);
        await client.query(
          `UPDATE persona_public_projection SET
          title=$3,summary=$4,readme_text=$5,search_text=$6,publisher_name=$7,author_names=$8,
          tag_names=$9::text[],model_names=$10,category_id=$11::uuid,tag_ids=$12::uuid[],
          platform=$13,origin_type=$14,redistribution=$15,dialogue_count=$16,search_release_id=$2
          WHERE persona_id=$1 AND release_id=$2`,
          [
            row.persona_id,
            row.release_id,
            fields.title,
            fields.summary,
            fields.readmeText,
            fields.searchText,
            fields.publisherName,
            fields.authorNames,
            fields.tagNames,
            fields.modelNames,
            fields.categoryId,
            fields.tagIds,
            fields.platform,
            fields.originType,
            fields.redistribution,
            fields.dialogueCount,
          ],
        );
      }
      await client.query('COMMIT');
      if (!pending.rowCount) break;
    } catch (cause) {
      await client.query('ROLLBACK');
      throw cause;
    }
  }
  const unresolved = await client.query<{ total: string }>(
    'SELECT count(*)::text AS total FROM persona_public_projection WHERE search_release_id IS DISTINCT FROM release_id',
  );
  if (Number(unresolved.rows[0]?.total ?? 0)) throw new Error('PUBLIC_SEARCH_BACKFILL_INCOMPLETE');
}
