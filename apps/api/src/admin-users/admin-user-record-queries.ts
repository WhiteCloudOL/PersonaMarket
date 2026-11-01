import { sql } from 'drizzle-orm';
import type { AdminUserReviewRecordsQuery } from '@personamarket/contracts';

export function adminUserReviewRecordsQuery(id: string, input: AdminUserReviewRecordsQuery) {
  return sql`
    WITH records AS MATERIALIZED (
      SELECT r.id,'persona'::text AS kind,r.created_at,jsonb_build_object(
        'id',r.id,'kind','persona','personaId',r.persona_id,'submissionId',r.submission_id,
        'actor',CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id',a.id,'username',a.username) END,
        'action',r.action,'reason',r.reason,'selfReview',r.self_review,'createdAt',r.created_at
      ) AS data
      FROM moderation_records r JOIN personas p ON p.id=r.persona_id
      LEFT JOIN users a ON a.id=r.actor_id
      WHERE p.owner_id=${id} AND (${input.kind}='all' OR ${input.kind}='persona')
      UNION ALL
      SELECT r.id,'comment'::text AS kind,r.created_at,jsonb_build_object(
        'id',r.id,'kind','comment','personaId',c.persona_id,'commentId',r.comment_id,'revisionId',r.revision_id,
        'actor',CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id',a.id,'username',a.username) END,
        'action',r.action,'reason',r.reason,'selfReview',r.self_review,'createdAt',r.created_at
      ) AS data
      FROM comment_moderation_records r JOIN comments c ON c.id=r.comment_id
      LEFT JOIN users a ON a.id=r.actor_id
      WHERE c.author_id=${id} AND (${input.kind}='all' OR ${input.kind}='comment')
    ), page AS (
      SELECT * FROM records ORDER BY created_at DESC,id DESC,kind ASC
      LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
    )
    SELECT COALESCE((SELECT jsonb_agg(data ORDER BY created_at DESC,id DESC,kind ASC) FROM page),'[]'::jsonb) AS data,
      (SELECT count(*)::int FROM records) AS total
  `;
}
