import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { comments, type Database } from '@personamarket/database';
import {
  CommentSettingsSchema,
  PublicCommentsResponseSchema,
  OwnCommentsResponseSchema,
  CommentModerationResponseSchema,
  type CommentsQuery,
  type CommentModerationQuerySchema,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { z } from 'zod';
import { DATABASE } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { commentPersona, commentSettings, commentTransaction } from './comment-helpers.js';
import { adminCommentView, ownCommentView } from './comment-views.js';
import {
  buildModerationCommentQueries,
  buildOwnCommentQueries,
  buildPublicCommentQueries,
} from './comment-queries.js';

@Injectable()
export class CommentsReadRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}

  public(personaId: string, input: CommentsQuery, parentId?: string) {
    return commentTransaction(
      this.database,
      async (tx) => {
        const configuration = await commentSettings(tx);
        await commentPersona(tx, personaId);
        if (parentId) {
          const [root] = await tx
            .select()
            .from(comments)
            .where(and(eq(comments.id, parentId), eq(comments.personaId, personaId)));
          if (!root || root.parentId || !root.firstPublishedAt)
            throw new BusinessError('NOT_FOUND', '评论楼层不存在或暂不可公开');
        }
        const settings = CommentSettingsSchema.parse({
          commentsEnabled: configuration.commentsEnabled,
          showExistingComments: configuration.showExistingComments,
          commentReviewMode: configuration.commentReviewMode,
          commentMaxLength: configuration.commentMaxLength,
          commentsPerMinute: configuration.commentsPerMinute,
        });
        if (!settings.showExistingComments)
          return PublicCommentsResponseSchema.parse({
            data: [],
            meta: { page: input.page, pageSize: input.pageSize, total: 0, publishedCount: 0 },
            settings,
          });
        const query = buildPublicCommentQueries(personaId, input, parentId);
        const rows = await tx.execute<{
          data: unknown;
        }>(query.rows);
        const total = await tx.execute<{ value: number }>(query.total);
        const published = await tx.execute<{
          value: number;
        }>(query.published);
        return PublicCommentsResponseSchema.parse({
          data: rows.rows.map((row) => row.data),
          meta: {
            page: input.page,
            pageSize: input.pageSize,
            total: total.rows[0]?.value ?? 0,
            publishedCount: published.rows[0]?.value ?? 0,
          },
          settings,
        });
      },
      true,
    );
  }

  own(actor: Identity, personaId: string, input: CommentsQuery) {
    return commentTransaction(this.database, async (tx) => {
      await lockIdentity(tx, actor, false, false);
      await commentPersona(tx, personaId);
      const query = buildOwnCommentQueries(personaId, actor.account.id, input);
      const rows = await tx.execute<{
        data: unknown;
      }>(query.rows);
      const count = await tx.execute<{ value: number }>(query.total);
      return OwnCommentsResponseSchema.parse({
        data: rows.rows.map((row) => row.data),
        meta: { page: input.page, pageSize: input.pageSize, total: count.rows[0]?.value ?? 0 },
      });
    });
  }

  ownDetail(actor: Identity, id: string) {
    return commentTransaction(this.database, async (tx) => {
      await lockIdentity(tx, actor, false, false);
      const [row] = await tx
        .select({ personaId: comments.personaId })
        .from(comments)
        .where(and(eq(comments.id, id), eq(comments.authorId, actor.account.id)));
      if (!row) throw new BusinessError('NOT_FOUND', '评论不存在或不可访问');
      await commentPersona(tx, row.personaId);
      return ownCommentView(tx, id, actor.account.id);
    });
  }

  queue(actor: Identity, input: z.infer<typeof CommentModerationQuerySchema>) {
    return commentTransaction(this.database, async (tx) => {
      const { account } = await lockIdentity(tx, actor, false, false);
      if (!['admin', 'moderator'].includes(account.role))
        throw new BusinessError('FORBIDDEN', '此操作需要审核权限');
      const query = buildModerationCommentQueries(input);
      const rows = await tx.execute<{
        data: unknown;
      }>(query.rows);
      const count = await tx.execute<{ value: number }>(query.total);
      return CommentModerationResponseSchema.parse({
        data: rows.rows.map((row) => row.data),
        meta: { page: input.page, pageSize: input.pageSize, total: count.rows[0]?.value ?? 0 },
      });
    });
  }

  detail(actor: Identity, id: string) {
    return commentTransaction(this.database, async (tx) => {
      const { account } = await lockIdentity(tx, actor, false, false);
      if (!['admin', 'moderator'].includes(account.role))
        throw new BusinessError('FORBIDDEN', '此操作需要审核权限');
      return adminCommentView(tx, id);
    });
  }
}
