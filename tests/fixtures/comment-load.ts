import type { PoolClient } from 'pg';

/** 只供隔离容量库：复制经真实API产生的评论，保持全部触发器、外键与审核记录约束 */
export async function seedCommentLoad(
  client: PoolClient,
  templateId: string,
  count: number,
  distribute = false,
  offset = 0,
) {
  const source = await client.query<{
    persona_id: string;
    parent_id: string | null;
    public_revision_id: string | null;
  }>('SELECT persona_id,parent_id,public_revision_id FROM comments WHERE id=$1', [templateId]);
  const template = source.rows[0];
  if (
    !template ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 1000 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    throw new Error('缺少受控评论样本或批次超过1000条');
  if (distribute && (template.parent_id || !template.public_revision_id))
    throw new Error('分布式样本要求已批准的一级评论');
  await client.query('BEGIN');
  try {
    await client.query(
      `CREATE TEMP TABLE comment_load_ids ON COMMIT DROP AS
      SELECT gen_random_uuid() AS id,gen_random_uuid() AS revision_id,
        CASE WHEN $3::boolean THEN targets.ids[1+($4::integer+n-1)%cardinality(targets.ids)] ELSE $2::uuid END AS persona_id
      FROM generate_series(1,$1::integer) n CROSS JOIN
        (SELECT array_agg(id ORDER BY id) AS ids FROM personas WHERE id<>$2 AND published_release_id IS NOT NULL) targets`,
      [count, template.persona_id, distribute, offset],
    );
    await client.query(
      `INSERT INTO comments SELECT populated.*
      FROM comment_load_ids i JOIN personas target ON target.id=i.persona_id CROSS JOIN comments source,
      LATERAL jsonb_populate_record(NULL::comments,to_jsonb(source)||jsonb_build_object(
        'id',i.id,'persona_id',i.persona_id,'release_id',target.published_release_id,
        'latest_revision_id',i.revision_id,
        'public_revision_id',CASE WHEN source.public_revision_id IS NULL THEN NULL ELSE i.revision_id END,
        'pending_revision_id',CASE WHEN source.pending_revision_id IS NULL THEN NULL ELSE i.revision_id END)) populated
      WHERE source.id=$1`,
      [templateId],
    );
    await client.query(
      `INSERT INTO comment_revisions SELECT populated.*
      FROM comment_load_ids i CROSS JOIN comments source JOIN comment_revisions r ON r.id=source.latest_revision_id,
      LATERAL jsonb_populate_record(NULL::comment_revisions,to_jsonb(r)||jsonb_build_object(
        'id',i.revision_id,'comment_id',i.id,'status','PENDING','reason',NULL)) populated
      WHERE source.id=$1`,
      [templateId],
    );
    if (template.public_revision_id) {
      await client.query(
        `INSERT INTO comment_moderation_records SELECT populated.*
        FROM comment_load_ids i CROSS JOIN comment_moderation_records source,
        LATERAL jsonb_populate_record(NULL::comment_moderation_records,to_jsonb(source)||jsonb_build_object(
          'id',gen_random_uuid(),'comment_id',i.id,'revision_id',i.revision_id)) populated
        WHERE source.comment_id=$1 AND source.revision_id=$2 AND source.action IN ('approve','auto_approve')`,
        [templateId, template.public_revision_id],
      );
      await client.query(
        "UPDATE comment_revisions r SET status='APPROVED' FROM comment_load_ids i WHERE r.id=i.revision_id",
      );
    }
    await client.query('COMMIT');
  } catch (cause) {
    await client.query('ROLLBACK');
    throw cause;
  }
}
