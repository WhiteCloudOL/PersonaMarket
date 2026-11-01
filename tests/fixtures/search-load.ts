import type { PoolClient } from 'pg';
import { PublicSnapshotSchema } from '@personamarket/contracts';
import { buildPublicSearchProjection } from '@personamarket/persona-adapters';
import { contentHash } from '@personamarket/server';

/** 仅供隔离测试库：复制通过真实审核的基准作品，保持所有约束启用 */
export async function seedSearchLoad(client: PoolClient, templateId: string, count: number) {
  const source = await client.query<{ snapshot: unknown; publication: unknown; changelog: string }>(
    `SELECT s.snapshot,s.publication,s.changelog FROM personas p JOIN persona_releases r ON r.id=p.published_release_id JOIN release_submissions s ON s.id=r.approved_submission_id WHERE p.id=$1`,
    [templateId],
  );
  const template = source.rows[0];
  if (!template) throw new Error('缺少审核基准快照');
  const snapshot = {
    ...PublicSnapshotSchema.parse(template.snapshot),
    title: '容量基准星辰',
    readmeMarkdown: 'benchmark-token-rare',
  };
  const fields = buildPublicSearchProjection(snapshot, template.publication);
  const hash = contentHash({
    snapshot,
    publication: template.publication,
    changelog: template.changelog,
  });
  await client.query('BEGIN');
  try {
    await client.query(
      'CREATE TEMP TABLE search_load_ids ON COMMIT DROP AS SELECT gen_random_uuid() AS persona_id, gen_random_uuid() AS release_id,gen_random_uuid() AS submission_id FROM generate_series(1,$1)',
      [count],
    );
    await client.query(
      `INSERT INTO personas(id,owner_id,platform,first_published_at)
      SELECT i.persona_id,p.owner_id,p.platform,p.first_published_at FROM search_load_ids i CROSS JOIN personas p WHERE p.id=$1`,
      [templateId],
    );
    await client.query(
      `INSERT INTO persona_releases(id,persona_id,version,major,minor,patch,lifecycle,approved_submission_id,published_at)
      SELECT i.release_id,i.persona_id,r.version,r.major,r.minor,r.patch,r.lifecycle,i.submission_id,r.published_at
      FROM search_load_ids i CROSS JOIN personas p JOIN persona_releases r ON r.id=p.published_release_id WHERE p.id=$1`,
      [templateId],
    );
    await client.query(
      `INSERT INTO release_submissions(id,persona_id,release_id,submitted_by,attempt_number,snapshot,publication,changelog,content_hash,status)
      SELECT i.submission_id,i.persona_id,i.release_id,s.submitted_by,1,
      $2::jsonb,s.publication,s.changelog,$3,'APPROVED'
      FROM search_load_ids i CROSS JOIN personas p JOIN persona_releases r ON r.id=p.published_release_id
      JOIN release_submissions s ON s.id=r.approved_submission_id WHERE p.id=$1`,
      [templateId, JSON.stringify(snapshot), hash],
    );
    await client.query(
      'UPDATE personas p SET published_release_id=i.release_id FROM search_load_ids i WHERE p.id=i.persona_id',
    );
    await client.query(
      `INSERT INTO persona_public_projection
      SELECT populated.* FROM search_load_ids i CROSS JOIN persona_public_projection source,
      LATERAL jsonb_populate_record(NULL::persona_public_projection,to_jsonb(source)||jsonb_build_object(
        'persona_id',i.persona_id,'release_id',i.release_id,'search_release_id',i.release_id,
        'title',$2::text,'readme_text',$3::text,'search_text',$4::text)) populated
      WHERE source.persona_id=$1`,
      [templateId, fields.title, fields.readmeText, fields.searchText],
    );
    await client.query('COMMIT');
  } catch (cause) {
    await client.query('ROLLBACK');
    throw cause;
  }
}
