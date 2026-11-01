import { and, asc, eq, inArray } from 'drizzle-orm';
import { comments, users } from '@personamarket/database';
import {
  ReportResolutionResultSchema,
  type ReportResolution,
  type ReportResolutionResult,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { applyUserAdministration } from '../admin-users/user-administration.js';
import { persistCommentVisibility } from '../comments/comment-visibility.js';
import { lockPersona } from '../releases/release-helpers.js';
import { applyPersonaModeration, applyReleaseModeration } from '../releases/moderation-actions.js';
import type { ReportRow } from './report-views.js';
import { requireProfile } from '../profiles/profile-views.js';
import { persistProfileVisibility } from '../profiles/profile-visibility.js';

/** 先锁通知收件人再锁内容，避免其本人写入持有user锁等待内容锁时形成环 */
export async function lockReportParticipants(tx: Transaction, row: ReportRow) {
  await tx
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, [...new Set([row.reporterId, row.reportedUserId])]))
    .orderBy(asc(users.id))
    .for('no key update');
}

/** 目标仅来自冻结的举报引用；调用方已取得管理串行锁及近期身份验证 */
export async function applyReportResolution(
  tx: Transaction,
  actor: Identity,
  row: ReportRow,
  command: ReportResolution,
  requestId: string,
) {
  const self = row.reportedUserId === actor.account.id;
  let content: ReportResolutionResult['content'] = null;
  if (command.content) {
    const { action, expectedRevision } = command.content;
    const matching =
      row.type === 'profile'
        ? action === 'hide_profile'
        : row.type === 'comment'
          ? action === 'hide_comment'
          : action === 'block_persona' || action === 'block_release';
    if (!matching) throw new BusinessError('INVALID_INPUT', '处置类型与举报目标不符');
    if (action === 'hide_profile') {
      if (!row.profileUserId || !row.profileSubmissionId)
        throw new BusinessError('INVALID_RESPONSE', '举报资料引用缺失');
      const profile = await requireProfile(tx, row.profileUserId, true);
      if (profile.publishedSubmissionId !== row.profileSubmissionId)
        throw new BusinessError('REVISION_CONFLICT', '公开资料已更新，请核对新版后单独处理');
      const changed = await persistProfileVisibility(
        tx,
        actor,
        profile,
        { hidden: true, expectedRevision, reason: command.reason },
        requestId,
        self,
      );
      content = {
        action,
        resourceId: changed.resourceId,
        beforeRevision: changed.beforeRevision,
        afterRevision: changed.afterRevision,
        recordId: changed.recordId,
      };
    } else {
      if (!row.personaId || !row.releaseId)
        throw new BusinessError('INVALID_RESPONSE', '举报作品引用缺失');
      if (action === 'hide_comment') {
        await lockPersona(tx, row.personaId);
        const [comment] = await tx
          .select()
          .from(comments)
          .where(and(eq(comments.id, row.targetId), eq(comments.personaId, row.personaId)))
          .for('update');
        if (!comment || comment.authorId !== row.reportedUserId)
          throw new BusinessError('CONFLICT', '举报目标已变化，请重新核对');
        if (comment.publicRevisionId !== row.commentRevisionId)
          throw new BusinessError('REVISION_CONFLICT', '评论公开文本已更新，请核对新版后单独处理');
        const changed = await persistCommentVisibility(
          tx,
          actor,
          comment,
          { hidden: true, expectedRevision, reason: command.reason },
          requestId,
          self,
        );
        if (!changed) throw new BusinessError('CONFLICT', '评论已隐藏，请核对当前状态');
        content = { action, ...changed };
      } else if (action === 'block_persona') {
        content = {
          action,
          ...(await applyPersonaModeration(
            tx,
            actor,
            row.personaId,
            { state: 'blocked', expectedRevision, reason: command.reason },
            requestId,
            self,
          )),
        };
      } else {
        content = {
          action,
          ...(await applyReleaseModeration(
            tx,
            actor,
            row.personaId,
            row.releaseId,
            'block',
            command.reason,
            requestId,
            expectedRevision,
            self,
          )),
        };
      }
    }
  }
  let account: ReportResolutionResult['account'] = null;
  if (command.account) {
    const changed = await applyUserAdministration(
      tx,
      actor,
      row.reportedUserId,
      {
        action: 'set_status',
        input: {
          status: 'banned',
          scope: command.account.scope,
          expectedSecurityVersion: command.account.expectedSecurityVersion,
          reason: command.reason,
        },
      },
      requestId,
    );
    account = {
      userId: row.reportedUserId,
      beforeSecurityVersion: changed.before.securityVersion,
      afterSecurityVersion: changed.after.securityVersion,
      recordId: changed.recordId,
      revokedSessions: changed.revokedSessions,
      affectedPersonas: changed.affectedPersonas,
    };
  }
  return ReportResolutionResultSchema.parse({ content, account });
}
