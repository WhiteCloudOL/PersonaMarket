import { persistCommentVisibility } from './comment-visibility.js';
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  comments,
  commentRevisions,
  commentModerationRecords,
  personas,
  userMfa,
  users,
  type Database,
} from '@personamarket/database';
import type {
  BulkReviewCommentsSchema,
  CommentVisibilitySchema,
  ReviewCommentSchema,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { z } from 'zod';
import { DATABASE } from '../tokens.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { requireRecentVerification } from '../auth/verification-policy.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';
import {
  commentPersona,
  commentSettings,
  commentTransaction,
  lockedComment,
  type CommentRow,
} from './comment-helpers.js';
import { adminCommentView } from './comment-views.js';
import { notifyCommentReview } from './comment-notifications.js';

function moderator(role: string) {
  if (!['moderator', 'admin'].includes(role))
    throw new BusinessError('FORBIDDEN', '此操作需要审核权限');
}
async function selfReview(
  tx: Transaction,
  identity: Awaited<ReturnType<typeof lockIdentity>>,
  row: CommentRow,
  confirmed: boolean,
  reason: string,
) {
  const self = row.authorId === identity.account.id;
  if (!self) return false;
  if (identity.account.role !== 'admin' || !confirmed || !reason.trim())
    throw new BusinessError('FORBIDDEN', '管理员自审需要近期验证、明确确认和理由');
  const [mfa] = await tx
    .select({ confirmedAt: userMfa.confirmedAt })
    .from(userMfa)
    .where(eq(userMfa.userId, identity.account.id));
  requireRecentVerification({ ...identity, mfaEnrolled: Boolean(mfa?.confirmedAt) }, true);
  return true;
}

@Injectable()
export class CommentsModerationRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}

  async location(id: string) {
    const [row] = await this.database.db
      .select({ personaId: comments.personaId })
      .from(comments)
      .where(eq(comments.id, id));
    if (!row) throw new BusinessError('NOT_FOUND', '评论不存在或不可访问');
    return row.personaId;
  }

  bulkReceipt(actor: Identity, input: z.infer<typeof BulkReviewCommentsSchema>, key: string) {
    return commentTransaction(this.database, async (tx) => {
      const { account } = await lockIdentity(tx, actor, false, false);
      moderator(account.role);
      if (!(await idempotentResult(tx, actor, 'comment.bulk', key, input)))
        await rememberResult(tx, actor, 'comment.bulk', key, input, key);
    });
  }

  async review(
    actor: Identity,
    id: string,
    input: z.infer<typeof ReviewCommentSchema>,
    key: string,
    requestId: string,
    bulk = false,
  ) {
    const personaId = await this.location(id);
    return commentTransaction(this.database, async (tx) => {
      const identity = await lockIdentity(tx, actor, false, false);
      moderator(identity.account.role);
      await commentSettings(tx, true);
      await tx
        .select({ id: personas.id })
        .from(personas)
        .where(eq(personas.id, personaId))
        .for('update');
      const row = await lockedComment(tx, id);
      const operation = bulk ? 'comment.bulk.review.' + id : 'comment.review';
      const command = { id, ...input };
      const retry = await idempotentResult(tx, actor, operation, key, command);
      if (retry) return adminCommentView(tx, retry);
      if (row.revision !== input.expectedRevision)
        throw new BusinessError('REVISION_CONFLICT', '评论已更新，请刷新待审文本后重试');
      if (
        row.visibility !== 'normal' ||
        row.pendingRevisionId !== input.revisionId ||
        row.latestRevisionId !== input.revisionId
      )
        throw new BusinessError('CONFLICT', '这份待审文本已经更换、隐藏或处理');
      const [revision] = await tx
        .select()
        .from(commentRevisions)
        .where(eq(commentRevisions.id, input.revisionId))
        .for('update');
      if (!revision || revision.status !== 'PENDING')
        throw new BusinessError('CONFLICT', '这份评论文本已被处理');
      const self = await selfReview(tx, identity, row, input.selfReviewConfirmed, input.reason);
      if (input.decision === 'approve') {
        await commentPersona(tx, personaId);
        const [author] = await tx
          .select({ status: users.status, verified: users.emailVerifiedAt })
          .from(users)
          .where(eq(users.id, row.authorId));
        if (!author || author.status !== 'active' || !author.verified)
          throw new BusinessError('FORBIDDEN', '评论账号当前不符合公开条件');
      }
      await tx
        .update(commentRevisions)
        .set({
          status: input.decision === 'approve' ? 'APPROVED' : 'REJECTED',
          reason: input.reason,
        })
        .where(eq(commentRevisions.id, revision.id));
      await tx
        .update(comments)
        .set({
          pendingRevisionId: null,
          revision: sql`${comments.revision}+1`,
          updatedAt: sql`clock_timestamp()`,
          ...(input.decision === 'approve'
            ? {
                publicRevisionId: revision.id,
                firstPublishedAt: sql`COALESCE(${comments.firstPublishedAt},clock_timestamp())`,
              }
            : {}),
        })
        .where(eq(comments.id, id));
      await tx.insert(commentModerationRecords).values({
        commentId: id,
        revisionId: revision.id,
        actorId: identity.account.id,
        action: input.decision,
        reason: input.reason,
        selfReview: self,
        requestId,
      });
      await notifyCommentReview(tx, row, revision.id, input.decision, identity.account.id);
      await rememberResult(tx, actor, operation, key, command, id);
      return adminCommentView(tx, id);
    });
  }

  async visibility(
    actor: Identity,
    id: string,
    input: z.infer<typeof CommentVisibilitySchema>,
    key: string,
    requestId: string,
  ) {
    const personaId = await this.location(id);
    return commentTransaction(this.database, async (tx) => {
      const identity = await lockIdentity(tx, actor, true, false);
      await commentSettings(tx, true);
      await tx
        .select({ id: personas.id })
        .from(personas)
        .where(eq(personas.id, personaId))
        .for('update');
      const row = await lockedComment(tx, id);
      const command = { id, ...input };
      const retry = await idempotentResult(tx, actor, 'comment.visibility', key, command);
      if (retry) return adminCommentView(tx, retry);
      if (row.visibility === 'deleted')
        throw new BusinessError('CONFLICT', '作者已删除的评论不能恢复或隐藏');
      if (row.revision !== input.expectedRevision)
        throw new BusinessError('REVISION_CONFLICT', '评论已更新，请刷新后重新确认');
      const self = !input.hidden
        ? await selfReview(tx, identity, row, input.selfReviewConfirmed, input.reason)
        : false;
      if (!input.hidden) await commentPersona(tx, personaId);
      await persistCommentVisibility(
        tx,
        identity,
        row,
        { hidden: input.hidden, expectedRevision: input.expectedRevision, reason: input.reason },
        requestId,
        self,
      );
      await rememberResult(tx, actor, 'comment.visibility', key, command, id);
      return adminCommentView(tx, id);
    });
  }
}
