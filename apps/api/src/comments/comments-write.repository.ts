import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  comments,
  commentRevisions,
  commentModerationRecords,
  personas,
  users,
  type Database,
} from '@personamarket/database';
import {
  CommentActionResponseSchema,
  type CreateCommentSchema,
  type EditCommentSchema,
  type DeleteCommentSchema,
} from '@personamarket/contracts';
import { BusinessError, assertOrdinaryWriteAllowed } from '@personamarket/server';
import type { z } from 'zod';
import { DATABASE } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';
import {
  commentPersona,
  commentRelease,
  commentSettings,
  commentTransaction,
  lockedComment,
} from './comment-helpers.js';
import { ownCommentView } from './comment-views.js';
import {
  auditComment,
  autoApproveComment,
  preventDuplicateComment,
  validateCommentWrite,
  verifiedCommenter,
} from './comment-write-helpers.js';

@Injectable()
export class CommentsWriteRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}

  async location(id: string) {
    const [row] = await this.database.db
      .select({ personaId: comments.personaId })
      .from(comments)
      .where(eq(comments.id, id));
    if (!row) throw new BusinessError('NOT_FOUND', '评论不存在或不可访问');
    return row.personaId;
  }

  create(
    actor: Identity,
    personaId: string,
    input: z.infer<typeof CreateCommentSchema>,
    key: string,
    requestId: string,
  ) {
    return commentTransaction(this.database, async (tx) => {
      const { account } = await lockIdentity(tx, actor, false, false);
      verifiedCommenter(account);
      await commentSettings(tx);
      await commentPersona(tx, personaId);
      const operation = { personaId, ...input };
      const retry = await idempotentResult(tx, actor, 'comment.create', key, operation);
      if (retry) return ownCommentView(tx, retry, account.id);
      await assertOrdinaryWriteAllowed(tx);
      const configuration = await commentSettings(tx, true);
      const persona = await commentPersona(tx, personaId, true);
      await validateCommentWrite(tx, account.id, input.body, configuration);
      const releaseId = input.releaseId ?? persona.releaseId;
      if (!releaseId) throw new BusinessError('NOT_FOUND', '评论引用的版本不存在或暂不可公开');
      await commentRelease(tx, personaId, releaseId);
      if (input.parentId) {
        const [root] = await tx
          .select({ comment: comments, author: users })
          .from(comments)
          .innerJoin(users, eq(users.id, comments.authorId))
          .where(and(eq(comments.id, input.parentId), eq(comments.personaId, personaId)));
        if (
          !root ||
          root.comment.parentId ||
          root.comment.visibility !== 'normal' ||
          !root.comment.publicRevisionId ||
          root.author.status !== 'active' ||
          !root.author.emailVerifiedAt
        )
          throw new BusinessError('NOT_FOUND', '只能回复可公开访问的一级评论');
        if (input.replyToId) {
          const [target] = await tx
            .select({ comment: comments, author: users })
            .from(comments)
            .innerJoin(users, eq(users.id, comments.authorId))
            .where(and(eq(comments.id, input.replyToId), eq(comments.personaId, personaId)));
          if (
            !target ||
            (target.comment.id !== input.parentId && target.comment.parentId !== input.parentId) ||
            target.comment.visibility !== 'normal' ||
            !target.comment.publicRevisionId ||
            target.author.status !== 'active' ||
            !target.author.emailVerifiedAt
          )
            throw new BusinessError('NOT_FOUND', '被回复的评论不存在或暂不可公开');
        }
      }
      await preventDuplicateComment(tx, account.id, personaId, input.parentId ?? null, input.body);
      const id = randomUUID();
      const revisionId = randomUUID();
      await tx.insert(comments).values({
        id,
        personaId,
        authorId: account.id,
        parentId: input.parentId ?? null,
        replyToId: input.parentId ? (input.replyToId ?? input.parentId) : null,
        releaseId,
        latestRevisionId: revisionId,
        pendingRevisionId: revisionId,
      });
      await tx
        .insert(commentRevisions)
        .values({ id: revisionId, commentId: id, number: 1, body: input.body });
      await auditComment(tx, account.id, requestId, 'comment.created');
      if (configuration.commentReviewMode === 'off')
        await autoApproveComment(tx, id, revisionId, requestId);
      await rememberResult(tx, actor, 'comment.create', key, operation, id);
      return ownCommentView(tx, id, account.id);
    });
  }

  async edit(
    actor: Identity,
    id: string,
    input: z.infer<typeof EditCommentSchema>,
    key: string,
    requestId: string,
  ) {
    const personaId = await this.location(id);
    return commentTransaction(this.database, async (tx) => {
      const { account } = await lockIdentity(tx, actor, false, false);
      verifiedCommenter(account);
      await commentSettings(tx);
      await commentPersona(tx, personaId);
      await ownCommentView(tx, id, account.id);
      const operation = { id, ...input };
      const retry = await idempotentResult(tx, actor, 'comment.edit', key, operation);
      if (retry) return ownCommentView(tx, retry, account.id);
      await assertOrdinaryWriteAllowed(tx);
      const configuration = await commentSettings(tx, true);
      await commentPersona(tx, personaId, true);
      const row = await lockedComment(tx, id);
      if (row.authorId !== account.id) throw new BusinessError('NOT_FOUND', '评论不存在或不可访问');
      if (row.visibility !== 'normal') throw new BusinessError('CONFLICT', '评论当前不可编辑');
      if (row.revision !== input.expectedRevision)
        throw new BusinessError('REVISION_CONFLICT', '评论已更新，请刷新后重新确认');
      await validateCommentWrite(tx, account.id, input.body, configuration);
      if (!row.latestRevisionId) throw new Error('COMMENT_REVISION_MISSING');
      const [latest] = await tx
        .select()
        .from(commentRevisions)
        .where(eq(commentRevisions.id, row.latestRevisionId));
      if (!latest) throw new Error('COMMENT_REVISION_MISSING');
      if (latest.body === input.body) {
        await rememberResult(tx, actor, 'comment.edit', key, operation, id);
        return ownCommentView(tx, id, account.id);
      }
      await preventDuplicateComment(tx, account.id, personaId, row.parentId, input.body, id);
      if (row.pendingRevisionId)
        await tx
          .update(commentRevisions)
          .set({ status: 'SUPERSEDED', reason: null })
          .where(eq(commentRevisions.id, row.pendingRevisionId));
      const revisionId = randomUUID();
      await tx
        .insert(commentRevisions)
        .values({ id: revisionId, commentId: id, number: latest.number + 1, body: input.body });
      await tx
        .update(comments)
        .set({
          latestRevisionId: revisionId,
          pendingRevisionId: revisionId,
          revision: sql`${comments.revision}+1`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(comments.id, id));
      await auditComment(tx, account.id, requestId, 'comment.edited');
      if (configuration.commentReviewMode === 'off')
        await autoApproveComment(tx, id, revisionId, requestId);
      await rememberResult(tx, actor, 'comment.edit', key, operation, id);
      return ownCommentView(tx, id, account.id);
    });
  }

  async delete(
    actor: Identity,
    id: string,
    input: z.infer<typeof DeleteCommentSchema>,
    key: string,
    requestId: string,
  ) {
    const personaId = await this.location(id);
    return commentTransaction(this.database, async (tx) => {
      const { account } = await lockIdentity(tx, actor, false, false);
      await commentSettings(tx);
      const [prior] = await tx
        .select()
        .from(comments)
        .where(and(eq(comments.id, id), eq(comments.authorId, account.id)));
      if (!prior) throw new BusinessError('NOT_FOUND', '评论不存在或不可访问');
      const operation = { id, ...input };
      const retry = await idempotentResult(tx, actor, 'comment.delete', key, operation);
      if (retry)
        return CommentActionResponseSchema.parse({
          data: { id, revision: prior.revision, visibility: prior.visibility },
        });
      await assertOrdinaryWriteAllowed(tx);
      await commentSettings(tx, true);
      await tx
        .select({ id: personas.id })
        .from(personas)
        .where(eq(personas.id, personaId))
        .for('update');
      const row = await lockedComment(tx, id);
      if (row.authorId !== account.id) throw new BusinessError('NOT_FOUND', '评论不存在或不可访问');
      if (row.visibility !== 'deleted') {
        if (row.revision !== input.expectedRevision)
          throw new BusinessError('REVISION_CONFLICT', '评论已更新，请刷新后重新确认');
        if (row.pendingRevisionId)
          await tx
            .update(commentRevisions)
            .set({ status: 'SUPERSEDED', reason: null })
            .where(eq(commentRevisions.id, row.pendingRevisionId));
        await tx
          .update(comments)
          .set({
            visibility: 'deleted',
            pendingRevisionId: null,
            revision: sql`${comments.revision}+1`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(comments.id, id));
        await tx
          .insert(commentModerationRecords)
          .values({ commentId: id, actorId: account.id, action: 'delete', requestId });
        await auditComment(tx, account.id, requestId, 'comment.deleted');
      }
      await rememberResult(tx, actor, 'comment.delete', key, operation, id);
      const updated = await lockedComment(tx, id);
      return CommentActionResponseSchema.parse({
        data: { id, revision: updated.revision, visibility: updated.visibility },
      });
    });
  }
}
