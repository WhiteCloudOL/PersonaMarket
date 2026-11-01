import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

/** 仅供受控隔离库：用真实获批模板插入完整历史，所有不可变与延迟约束保持启用 */
export async function seedRankingHistory(
  client: PoolClient,
  templateId: string,
  firstPublishedAt: Date,
  currentPublishedAt: Date,
) {
  const database = await client.query<{ name: string }>('SELECT current_database() AS name');
  if (!/^pm_auth_case_[a-f0-9]{32}_test$/.test(database.rows[0]?.name ?? ''))
    throw new Error('历史样本仅允许写入当前受控认证测试库');
  if (!(currentPublishedAt > firstPublishedAt)) throw new Error('历史发布时间顺序无效');
  const id = randomUUID();
  const firstReleaseId = randomUUID();
  const releaseId = randomUUID();
  await client.query('BEGIN');
  try {
    const persona = await client.query(
      `INSERT INTO personas(id,owner_id,platform,first_published_at,created_at)
      SELECT $2,p.owner_id,p.platform,$3::timestamptz,$3::timestamptz-interval '1 second'
      FROM personas p WHERE p.id=$1 RETURNING id`,
      [templateId, id, firstPublishedAt],
    );
    if (persona.rowCount !== 1) throw new Error('缺少历史样本真实审核模板');
    for (const [patch, nextId, publishedAt] of [
      [0, firstReleaseId, firstPublishedAt],
      [1, releaseId, currentPublishedAt],
    ] as const) {
      const submissionId = randomUUID();
      await client.query(
        `INSERT INTO persona_releases(id,persona_id,version,major,minor,patch,lifecycle,approved_submission_id,published_at,created_at)
        VALUES ($1,$2,$3,1,0,$4,'PUBLISHED',$5,$6::timestamptz,$6::timestamptz-interval '1 second')`,
        [nextId, id, '1.0.' + patch, patch, submissionId, publishedAt],
      );
      await client.query(
        `INSERT INTO release_submissions(id,persona_id,release_id,submitted_by,attempt_number,snapshot,publication,changelog,content_hash,status,revision,created_at)
        SELECT $2,$3,$4,s.submitted_by,1,s.snapshot,s.publication,s.changelog,s.content_hash,'APPROVED',2,$5::timestamptz-interval '1 second'
        FROM personas p JOIN persona_releases r ON r.id=p.published_release_id
        JOIN release_submissions s ON s.id=r.approved_submission_id WHERE p.id=$1`,
        [templateId, submissionId, id, nextId, publishedAt],
      );
      await client.query(
        `INSERT INTO moderation_records(persona_id,submission_id,actor_id,action,reason,self_review,request_id,created_at)
        SELECT $2,$3,m.actor_id,m.action,m.reason,m.self_review,$4,$5
        FROM personas p JOIN persona_releases r ON r.id=p.published_release_id
        JOIN moderation_records m ON m.submission_id=r.approved_submission_id WHERE p.id=$1`,
        [templateId, id, submissionId, randomUUID(), publishedAt],
      );
    }
    await client.query('UPDATE personas SET published_release_id=$2 WHERE id=$1', [id, releaseId]);
    await client.query(
      `INSERT INTO persona_public_projection SELECT populated.*
      FROM persona_public_projection source,
      LATERAL jsonb_populate_record(NULL::persona_public_projection,to_jsonb(source)||jsonb_build_object(
        'persona_id',$2::uuid,'release_id',$3::uuid,'search_release_id',$3::uuid,'updated_at',$4::timestamptz)) populated
      WHERE source.persona_id=$1`,
      [templateId, id, releaseId, currentPublishedAt],
    );
    await client.query('COMMIT');
    return { id, firstReleaseId, releaseId };
  } catch (cause) {
    await client.query('ROLLBACK');
    throw cause;
  }
}
