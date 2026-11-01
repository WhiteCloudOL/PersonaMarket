import { sql, type SQL } from 'drizzle-orm';
import { AdminCommentSchema, OwnCommentSchema } from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';

// 别名只由模块内静态SQL传入，不接受用户提供的标识符
export function publishedComment(alias: SQL, author: SQL) {
  return sql`${alias}.visibility='normal' AND ${alias}.public_revision_id IS NOT NULL
    AND ${author}.status='active' AND ${author}.email_verified_at IS NOT NULL`;
}
const releaseReference = sql`(
  SELECT jsonb_build_object('id',v.id,'version',v.version)
  FROM persona_releases v JOIN release_submissions vs
    ON vs.id=v.approved_submission_id AND vs.persona_id=v.persona_id AND vs.release_id=v.id
  WHERE v.id=c.release_id AND v.persona_id=c.persona_id AND v.lifecycle='PUBLISHED' AND vs.status='APPROVED'
)`;
const replyReference = sql`(
  SELECT jsonb_build_object('id',rt.id,'username',ru.username)
  FROM comments rt JOIN users ru ON ru.id=rt.author_id
  WHERE rt.id=c.reply_to_id AND ${publishedComment(sql`rt`, sql`ru`)}
)`;
const revisionJson = (alias: SQL) => sql`jsonb_build_object(
  'id',${alias}.id,'number',${alias}.number,'body',${alias}.body,
  'status',${alias}.status,'reason',${alias}.reason,'createdAt',${alias}.created_at
)`;
export const commentJoins = sql`FROM comments c
  JOIN comment_revisions l ON l.id=c.latest_revision_id AND l.comment_id=c.id
  LEFT JOIN comment_revisions p ON p.id=c.public_revision_id AND p.comment_id=c.id
  JOIN users cu ON cu.id=c.author_id`;
export const ownCommentJson = sql`jsonb_build_object(
  'id',c.id,'personaId',c.persona_id,'parentId',c.parent_id,'release',${releaseReference},
  'visibility',c.visibility,'revision',c.revision,'createdAt',c.created_at,
  'latest',${revisionJson(sql`l`)},'published',CASE WHEN p.id IS NULL THEN NULL ELSE ${revisionJson(sql`p`)} END
)`;
export const replyCount = sql`(
  SELECT count(*) FROM comments child JOIN users child_author ON child_author.id=child.author_id
  WHERE child.parent_id=c.id AND ${publishedComment(sql`child`, sql`child_author`)}
)`;
const publicLocation = sql`jsonb_build_object(
  'id',c.id,'personaId',c.persona_id,'parentId',c.parent_id,'replyTo',${replyReference},
  'release',${releaseReference},'createdAt',c.created_at,'replyCount',${replyCount}
)`;
export const publicCommentJson = sql`${publicLocation} || CASE
  WHEN ${publishedComment(sql`c`, sql`cu`)} THEN jsonb_build_object(
    'status','published','body',p.body,'publishedRevisionId',p.id,
    'author',jsonb_build_object('id',cu.id,'username',cu.username),
    'editedAt',CASE WHEN p.number>1 THEN p.created_at ELSE NULL END
  )
  ELSE jsonb_build_object('status',CASE WHEN c.visibility='deleted' THEN 'deleted'
    WHEN c.visibility='hidden' THEN 'hidden' ELSE 'unavailable' END)
END`;
export function adminCommentJson(history: boolean) {
  const records = history
    ? sql`COALESCE((SELECT jsonb_agg(history.data ORDER BY history.created_at DESC,history.id DESC) FROM (
    SELECT m.id,m.created_at,jsonb_build_object(
      'id',m.id,'actor',mu.username,'action',m.action,'reason',m.reason,'selfReview',m.self_review,
      'revisionId',m.revision_id,'createdAt',m.created_at
    ) AS data FROM comment_moderation_records m LEFT JOIN users mu ON mu.id=m.actor_id
    WHERE m.comment_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 100
  ) history),'[]'::jsonb)`
    : sql`'[]'::jsonb`;
  return sql`${ownCommentJson} || jsonb_build_object(
    'author',jsonb_build_object('id',cu.id,'username',cu.username),
    'personaTitle',(SELECT projection.title FROM persona_public_projection projection WHERE projection.persona_id=c.persona_id),
    'records',${records}
  )`;
}
export async function ownCommentView(tx: Transaction, id: string, userId: string) {
  const result = await tx.execute<{ data: unknown }>(
    sql`SELECT ${ownCommentJson} AS data ${commentJoins} WHERE c.id=${id} AND c.author_id=${userId}`,
  );
  const row = result.rows[0];
  if (!row) throw new BusinessError('NOT_FOUND', '评论不存在或不可访问');
  return { data: OwnCommentSchema.parse(row.data) };
}
export async function adminCommentView(tx: Transaction, id: string) {
  const result = await tx.execute<{ data: unknown }>(
    sql`SELECT ${adminCommentJson(true)} AS data ${commentJoins} WHERE c.id=${id}`,
  );
  const row = result.rows[0];
  if (!row) throw new BusinessError('NOT_FOUND', '评论不存在或不可访问');
  return { data: AdminCommentSchema.parse(row.data) };
}
