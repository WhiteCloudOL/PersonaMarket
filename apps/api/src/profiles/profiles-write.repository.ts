import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  profileDrafts,
  profileSubmissions,
  userProfiles,
  assets,
  type Database,
} from '@personamarket/database';
import {
  ProfileSubmissionResponseSchema,
  type SaveProfile,
  type SubmitProfile,
  type WithdrawProfile,
} from '@personamarket/contracts';
import {
  BusinessError,
  contentHash,
  assertOrdinaryWriteAllowed,
  type ServerEnvironment,
} from '@personamarket/server';
import { DATABASE, ENVIRONMENT } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';
import {
  ownProfileView,
  profileContent,
  profileSubmissionView,
  requireProfile,
  requireProfileSubmission,
} from './profile-views.js';
import { recordProfileAction } from './profile-transactions.js';
import { notifyProfileEmail } from './profile-notifications.js';

@Injectable()
export class ProfilesWriteRepository {
  constructor(
    @Inject(DATABASE) readonly database: Database,
    @Inject(ENVIRONMENT) readonly environment: ServerEnvironment,
  ) {}

  save(actor: Identity, input: SaveProfile) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const identity = await lockIdentity(tx, actor, false, false),
          userId = identity.account.id;
        await assertOrdinaryWriteAllowed(tx);
        await tx.insert(userProfiles).values({ userId }).onConflictDoNothing();
        await requireProfile(tx, userId, true);
        const [draft] = await tx
          .select()
          .from(profileDrafts)
          .where(eq(profileDrafts.userId, userId))
          .for('update');
        if ((draft?.revision ?? 0) !== input.expectedRevision)
          throw new BusinessError('REVISION_CONFLICT', '资料已更新，请保留当前输入并核对最新修订');
        if (input.content.avatarAssetId) {
          const [avatar] = await tx
            .select({ ownerId: assets.ownerId, purpose: assets.purpose })
            .from(assets)
            .where(eq(assets.id, input.content.avatarAssetId));
          if (!avatar || avatar.ownerId !== userId || avatar.purpose !== 'avatar')
            throw new BusinessError('NOT_FOUND', '头像素材不存在或不可访问');
        }
        if (draft)
          await tx
            .update(profileDrafts)
            .set({ ...input.content, revision: draft.revision + 1 })
            .where(eq(profileDrafts.userId, userId));
        else await tx.insert(profileDrafts).values({ userId, ...input.content });
        return ownProfileView(tx, userId, identity.account.username);
      },
      { area: 'content' },
    );
  }

  submit(actor: Identity, input: SubmitProfile, key: string, requestId: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const identity = await lockIdentity(tx, actor, false, false),
          userId = identity.account.id;
        if (!identity.account.emailVerifiedAt)
          throw new BusinessError('FORBIDDEN', '请先验证邮箱后再提交公开资料');
        await requireProfile(tx, userId);
        const previous = await idempotentResult(tx, actor, 'profile.submit', key, input);
        if (previous)
          return ProfileSubmissionResponseSchema.parse({
            data: profileSubmissionView(await requireProfileSubmission(tx, previous, userId)),
          });
        await assertOrdinaryWriteAllowed(tx);
        const profile = await requireProfile(tx, userId, true);
        const [draft] = await tx
          .select()
          .from(profileDrafts)
          .where(eq(profileDrafts.userId, userId))
          .for('update');
        if (!draft || draft.revision !== input.expectedDraftRevision)
          throw new BusinessError('REVISION_CONFLICT', '资料草稿已更新，请保存并核对最新修订');
        const [pending] = await tx
          .select({ id: profileSubmissions.id })
          .from(profileSubmissions)
          .where(
            sql`${profileSubmissions.userId}=${userId} AND ${profileSubmissions.status}='PENDING'`,
          )
          .limit(1);
        if (pending) throw new BusinessError('CONFLICT', '已有待审资料，请等待审核或先撤回');
        const snapshot = profileContent(draft);
        const [submission] = await tx
          .insert(profileSubmissions)
          .values({
            userId,
            draftRevision: draft.revision,
            ...snapshot,
            contentHash: contentHash(snapshot),
          })
          .returning();
        if (!submission) throw new Error('PROFILE_SUBMISSION_INSERT_FAILED');
        await recordProfileAction(tx, {
          userId,
          submissionId: submission.id,
          actorId: userId,
          action: 'submit',
          fromProfileRevision: profile.revision,
          toProfileRevision: profile.revision,
          requestId,
        });
        await rememberResult(tx, actor, 'profile.submit', key, input, submission.id);
        await notifyProfileEmail(tx, userId, this.environment, 'submit', '', submission.id);
        return ProfileSubmissionResponseSchema.parse({ data: profileSubmissionView(submission) });
      },
      { area: 'content' },
    );
  }

  async withdraw(
    actor: Identity,
    id: string,
    input: WithdrawProfile,
    key: string,
    requestId: string,
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const identity = await lockIdentity(tx, actor, false, false),
          userId = identity.account.id;
        await requireProfile(tx, userId);
        await requireProfileSubmission(tx, id, userId);
        const command = { id, ...input };
        const previous = await idempotentResult(tx, actor, 'profile.withdraw', key, command);
        if (previous)
          return ProfileSubmissionResponseSchema.parse({
            data: profileSubmissionView(await requireProfileSubmission(tx, previous, userId)),
          });
        await assertOrdinaryWriteAllowed(tx);
        const profile = await requireProfile(tx, userId, true),
          row = await requireProfileSubmission(tx, id, userId, true);
        if (row.status !== 'PENDING') throw new BusinessError('CONFLICT', '这份资料已经审核或撤回');
        if (row.revision !== input.expectedRevision)
          throw new BusinessError('REVISION_CONFLICT', '资料审核状态已变化，请核对后重试');
        const [updated] = await tx
          .update(profileSubmissions)
          .set({
            status: 'WITHDRAWN',
            revision: row.revision + 1,
            withdrawnAt: sql`clock_timestamp()`,
          })
          .where(eq(profileSubmissions.id, id))
          .returning();
        if (!updated) throw new Error('PROFILE_WITHDRAW_FAILED');
        await recordProfileAction(tx, {
          userId,
          submissionId: id,
          actorId: userId,
          action: 'withdraw',
          fromProfileRevision: profile.revision,
          toProfileRevision: profile.revision,
          requestId,
        });
        await rememberResult(tx, actor, 'profile.withdraw', key, command, id);
        return ProfileSubmissionResponseSchema.parse({ data: profileSubmissionView(updated) });
      },
      { area: 'content' },
    );
  }
}
