import { sql, type SQL } from 'drizzle-orm';
import type { CommentsQuery, CommentModerationQuerySchema } from '@personamarket/contracts';
import type { z } from 'zod';
import {
  adminCommentJson,
  commentJoins,
  ownCommentJson,
  publicCommentJson,
  publishedComment,
} from './comment-views.js';

function pageRows(
  projection: SQL,
  where: SQL,
  input: CommentsQuery,
  source = sql`FROM comments c`,
) {
  const direction = input.sort === 'newest' ? sql`DESC` : sql`ASC`;
  // 先分页轻量ID，再构造白名单正文与关联信息，避免OFFSET前的数万条也执行JSON和关联子查询
  return sql`WITH comment_page AS MATERIALIZED (
    SELECT c.id,c.created_at ${source} WHERE ${where}
    ORDER BY c.created_at ${direction},c.id ${direction}
    LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
  ) SELECT ${projection} AS data ${commentJoins} JOIN comment_page cp ON cp.id=c.id
    ORDER BY c.created_at ${direction},c.id ${direction}`;
}

/** 与仓库执行共用同一查询，容量验收直接解释这些SQL，避免维护另一套简化查询 */
export function buildPublicCommentQueries(
  personaId: string,
  input: CommentsQuery,
  parentId?: string,
) {
  const where = sql`c.persona_id=${personaId} AND c.first_published_at IS NOT NULL
    AND ${parentId ? sql`c.parent_id=${parentId}` : sql`c.parent_id IS NULL`}`;
  return {
    rows: pageRows(publicCommentJson, where, input),
    total: sql`SELECT count(*)::integer AS value FROM comments c WHERE ${where}`,
    published: sql`SELECT count(*)::integer AS value FROM comments c JOIN users cu ON cu.id=c.author_id
      WHERE c.persona_id=${personaId} AND c.first_published_at IS NOT NULL AND ${publishedComment(sql`c`, sql`cu`)}
      AND (c.parent_id IS NULL OR EXISTS (SELECT 1 FROM comments root WHERE root.id=c.parent_id AND root.first_published_at IS NOT NULL))`,
  };
}

export function buildOwnCommentQueries(personaId: string, accountId: string, input: CommentsQuery) {
  const where = sql`c.persona_id=${personaId} AND c.author_id=${accountId} AND c.visibility<>'deleted'`;
  return {
    rows: pageRows(ownCommentJson, where, input),
    total: sql`SELECT count(*)::integer AS value FROM comments c WHERE ${where}`,
  };
}

export function buildModerationCommentQueries(input: z.infer<typeof CommentModerationQuerySchema>) {
  const state =
    input.status === 'all'
      ? sql`true`
      : input.status === 'hidden'
        ? sql`c.visibility='hidden'`
        : input.status === 'PENDING'
          ? sql`c.visibility='normal' AND c.pending_revision_id IS NOT NULL`
          : sql`c.visibility='normal' AND l.status=${input.status}`;
  const where = sql`${state} AND ${input.personaId ? sql`c.persona_id=${input.personaId}` : sql`true`}`;
  const source = ['APPROVED', 'REJECTED'].includes(input.status)
    ? sql`FROM comments c JOIN comment_revisions l ON l.id=c.latest_revision_id AND l.comment_id=c.id`
    : sql`FROM comments c`;
  return {
    rows: pageRows(adminCommentJson(false), where, input, source),
    total: sql`SELECT count(*)::integer AS value ${commentJoins} WHERE ${where}`,
  };
}
