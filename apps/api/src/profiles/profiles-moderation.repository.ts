import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { profileSubmissions, userProfiles, users, type Database } from '@personamarket/database';
import {
  ProfileVisibilityResponseSchema,
  type ReviewProfile,
  type SetProfileVisibility,
} from '@personamarket/contracts';
import { BusinessError, type ServerEnvironment } from '@personamarket/server';
import { DATABASE, ENVIRONMENT } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';
import {
  requireProfile,
  requireProfileSubmission,
  moderationProfileView,
} from './profile-views.js';
import {
  recordProfileAction,
  requireProfileModerator,
  verifyProfileSelfReview,
} from './profile-transactions.js';
import { persistProfileVisibility } from './profile-visibility.js';
import { notifyProfileEmail } from './profile-notifications.js';

@Injectable()
export class ProfilesModerationRepository {
  constructor(
    @Inject(DATABASE) readonly database: Database,
    @Inject(ENVIRONMENT) readonly environment: ServerEnvironment,
  ) {}
  async review(actor: Identity, id: string, input: ReviewProfile, key: string, requestId: string) {
    const [location] = await this.database.db
      .select({ userId: profileSubmissions.userId })
      .from(profileSubmissions)
      .where(eq(profileSubmissions.id, id));
    if (!location) throw new BusinessError('NOT_FOUND', '资料快照不存在或不可访问');
    return administrationTransaction(
      this.database,
      async (tx) => {
        const identity = await lockIdentity(tx, actor, false, false);
        requireProfileModerator(identity.account.role);
        const [owner] = await tx
          .select()
          .from(users)
          .where(eq(users.id, location.userId))
          .for('no key update');
        if (!owner) throw new BusinessError('NOT_FOUND', '资料账号不存在或不可访问');
        const profile = await requireProfile(tx, owner.id, true),
          row = await requireProfileSubmission(tx, id, owner.id, true);
        const selfReview = await verifyProfileSelfReview(
            tx,
            identity,
            owner.id,
            input.selfReviewConfirmed,
            input.reason,
          ),
          command = { id, ...input };
        const previous = await idempotentResult(tx, actor, 'profile.review', key, command);
        if (previous) return moderationProfileView(tx, previous);
        if (row.status !== 'PENDING') throw new BusinessError('CONFLICT', '这份资料已经审核或撤回');
        if (row.revision !== input.expectedRevision)
          throw new BusinessError('REVISION_CONFLICT', '资料审核状态已变化，请核对后重试');
        if (input.decision === 'approve' && (owner.status !== 'active' || !owner.emailVerifiedAt))
          throw new BusinessError('FORBIDDEN', '当前账号不符合公开资料条件');
        await tx
          .update(profileSubmissions)
          .set({
            status: input.decision === 'approve' ? 'APPROVED' : 'REJECTED',
            revision: row.revision + 1,
            reason: input.reason,
            reviewedBy: identity.account.id,
            reviewedAt: sql`clock_timestamp()`,
          })
          .where(eq(profileSubmissions.id, id));
        if (input.decision === 'approve')
          await tx
            .update(userProfiles)
            .set({ publishedSubmissionId: id, revision: profile.revision + 1 })
            .where(eq(userProfiles.userId, owner.id));
        await recordProfileAction(tx, {
          userId: owner.id,
          submissionId: id,
          actorId: identity.account.id,
          action: input.decision,
          reason: input.reason,
          selfReview,
          fromProfileRevision: profile.revision,
          toProfileRevision: profile.revision + (input.decision === 'approve' ? 1 : 0),
          requestId,
        });
        await rememberResult(tx, actor, 'profile.review', key, command, id);
        await notifyProfileEmail(tx, owner.id, this.environment, input.decision, input.reason, id);
        return moderationProfileView(tx, id);
      },
      { area: 'content', serializeWrites: true },
    );
  }
  visibility(
    actor: Identity,
    userId: string,
    input: SetProfileVisibility,
    key: string,
    requestId: string,
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const identity = await lockIdentity(tx, actor, true, true);
        const [owner] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .for('no key update');
        if (!owner) throw new BusinessError('NOT_FOUND', '资料账号不存在或不可访问');
        const row = await requireProfile(tx, userId, true);
        const selfReview = await verifyProfileSelfReview(
            tx,
            identity,
            userId,
            input.selfReviewConfirmed,
            input.reason,
          ),
          command = { userId, ...input };
        const previous = await idempotentResult(tx, actor, 'profile.visibility', key, command);
        if (previous) {
          const current = await requireProfile(tx, previous);
          return ProfileVisibilityResponseSchema.parse({
            data: { userId: previous, visibility: current.visibility, revision: current.revision },
          });
        }
        const changed = await persistProfileVisibility(
          tx,
          actor,
          row,
          input,
          requestId,
          selfReview,
        );
        await rememberResult(tx, actor, 'profile.visibility', key, command, userId);
        return ProfileVisibilityResponseSchema.parse({
          data: {
            userId: changed.userId,
            visibility: changed.visibility,
            revision: changed.revision,
          },
        });
      },
      { area: 'content', serializeWrites: true },
    );
  }
}
