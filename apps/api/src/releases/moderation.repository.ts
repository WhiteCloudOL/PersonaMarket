import { applyPersonaModeration, applyReleaseModeration } from './moderation-actions.js';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, desc, sql } from 'drizzle-orm';
import {
  personas,
  personaReleases,
  releaseSubmissions,
  moderationRecords,
  assetReferences,
  users,
  type Database,
} from '@personamarket/database';
import {
  PublicSnapshotSchema,
  PublicationSchema,
  type ReviewRequestSchema,
  type PersonaModerationSchema,
} from '@personamarket/contracts';
import {
  BusinessError,
  assertOrdinaryWriteAllowed,
  type ServerEnvironment,
} from '@personamarket/server';
import type { z } from 'zod';
import { DATABASE, ENVIRONMENT } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { ReleasesRepository } from './releases.repository.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { removePersonas } from '../admin/delete-personas.js';
import {
  lockPersona,
  lockSubmission,
  idempotentResult,
  rememberResult,
  recordAction,
  notifyOwner,
  updateProjection,
  submissionView,
} from './release-helpers.js';
@Injectable()
export class ModerationRepository {
  constructor(
    @Inject(DATABASE) readonly database: Database,
    @Inject(ENVIRONMENT) private readonly env: ServerEnvironment,
    @Inject(ReleasesRepository) private readonly releases: ReleasesRepository,
  ) {}
  async queue(status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN', page: number) {
    const rows = await this.database.db
      .select({
        submission: releaseSubmissions,
        release: personaReleases,
        currentId: personas.publishedReleaseId,
      })
      .from(releaseSubmissions)
      .innerJoin(personaReleases, eq(personaReleases.id, releaseSubmissions.releaseId))
      .innerJoin(personas, eq(personas.id, releaseSubmissions.personaId))
      .where(eq(releaseSubmissions.status, status))
      .orderBy(desc(releaseSubmissions.createdAt), desc(releaseSubmissions.id))
      .limit(20)
      .offset((page - 1) * 20);
    return { data: rows.map((row) => submissionView(row.submission, row.release, row.currentId)) };
  }
  async detail(id: string) {
    const submission = await this.releases.readSubmission(id);
    const [persona] = await this.database.db
      .select()
      .from(personas)
      .where(eq(personas.id, submission.personaId));
    const [previous] = persona?.publishedReleaseId
      ? await this.database.db
          .select({ snapshot: releaseSubmissions.snapshot })
          .from(personaReleases)
          .innerJoin(
            releaseSubmissions,
            eq(personaReleases.approvedSubmissionId, releaseSubmissions.id),
          )
          .where(eq(personaReleases.id, persona.publishedReleaseId))
      : [];
    const [records, proofs] = await Promise.all([
      this.database.db
        .select({
          id: moderationRecords.id,
          action: moderationRecords.action,
          reason: moderationRecords.reason,
          selfReview: moderationRecords.selfReview,
          createdAt: moderationRecords.createdAt,
          actor: users.username,
        })
        .from(moderationRecords)
        .innerJoin(users, eq(users.id, moderationRecords.actorId))
        .where(eq(moderationRecords.personaId, submission.personaId))
        .orderBy(desc(moderationRecords.createdAt))
        .limit(100),
      this.database.db
        .select({ id: assetReferences.assetId })
        .from(assetReferences)
        .where(
          and(
            eq(assetReferences.resourceType, 'submission'),
            eq(assetReferences.resourceId, id),
            eq(assetReferences.purpose, 'evidence'),
          ),
        ),
    ]);
    return {
      data: {
        submission,
        previous: previous ? PublicSnapshotSchema.parse(previous.snapshot) : null,
        records: records.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        evidenceAssetIds: proofs.map((row) => row.id),
      },
    };
  }
  async review(
    actor: Identity,
    id: string,
    input: z.infer<typeof ReviewRequestSchema>,
    key: string,
    requestId: string,
  ) {
    const original = await this.releases.readSubmission(id);
    const result = await this.database.db.transaction(async (tx) => {
      const { account } = await lockIdentity(tx, actor, false, false);
      if (!['moderator', 'admin'].includes(account.role))
        throw new BusinessError('FORBIDDEN', '此操作需要审核权限');
      const retry = await idempotentResult(tx, actor, 'submission.review', key, { id, ...input });
      if (retry) return retry;
      const persona = await lockPersona(tx, original.personaId);
      const submission = await lockSubmission(tx, id);
      if (submission.status !== 'PENDING' || submission.revision !== input.expectedRevision)
        throw new BusinessError('CONFLICT', '提交已被处理或撤回，请刷新审核状态');
      if (persona.moderationState === 'blocked')
        throw new BusinessError('CONFLICT', '作品已被封禁，不能批准或驳回');
      const selfReview = persona.ownerId === account.id;
      if (selfReview && account.role !== 'admin')
        throw new BusinessError('FORBIDDEN', '审核员不能审核自己的作品');
      if (selfReview && (!input.selfReviewConfirmed || !input.reason.trim()))
        throw new BusinessError('FORBIDDEN', '管理员自审需要明确确认和理由');
      if (input.action === 'reject' && !input.reason.trim())
        throw new BusinessError('VALIDATION_FAILED', '驳回时请填写审核意见');
      const [release] = await tx
        .select()
        .from(personaReleases)
        .where(
          and(
            eq(personaReleases.id, submission.releaseId),
            eq(personaReleases.personaId, persona.id),
          ),
        )
        .for('update');
      if (!release || release.publishedAt)
        throw new BusinessError('CONFLICT', '版本状态已变化，请重新读取');
      const snapshot = PublicSnapshotSchema.parse(submission.snapshot);
      PublicationSchema.parse(submission.publication);
      await tx
        .update(releaseSubmissions)
        .set({
          status: input.action === 'approve' ? 'APPROVED' : 'REJECTED',
          reason: input.reason,
          revision: submission.revision + 1,
        })
        .where(eq(releaseSubmissions.id, id));
      if (input.action === 'approve') {
        await tx
          .update(personaReleases)
          .set({ lifecycle: 'PUBLISHED', approvedSubmissionId: id, publishedAt: new Date() })
          .where(eq(personaReleases.id, release.id));
        await tx
          .update(personas)
          .set({
            publishedReleaseId: release.id,
            revision: sql`${personas.revision}+1`,
            updatedAt: new Date(),
          })
          .where(eq(personas.id, persona.id));
        await updateProjection(tx, persona.id, release.id);
      }
      await recordAction(
        tx,
        actor,
        persona.id,
        input.action === 'approve' ? 'approved' : 'rejected',
        input.reason,
        requestId,
        id,
        selfReview,
      );
      await notifyOwner(
        tx,
        persona,
        this.env.APP_ENCRYPTION_KEY,
        input.action === 'approve' ? '人设版本审核通过' : '人设版本需要修改',
        snapshot.title +
          ' ' +
          release.version +
          (input.action === 'approve' ? ' 已审核通过' : ' 已退回，请查看审核意见：' + input.reason),
      );
      await rememberResult(tx, actor, 'submission.review', key, { id, ...input }, id);
      return id;
    });
    return { data: await this.releases.readSubmission(result) };
  }
  async visibility(
    actor: Identity,
    id: string,
    visibility: 'listed' | 'hidden',
    reason: string,
    requestId: string,
  ) {
    await this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      await assertOrdinaryWriteAllowed(tx);
      const persona = await lockPersona(tx, id, actor.account.id);
      if (persona.ownerVisibility === visibility) return;
      await tx
        .update(personas)
        .set({ ownerVisibility: visibility, revision: sql`${personas.revision}+1` })
        .where(eq(personas.id, id));
      await recordAction(
        tx,
        actor,
        id,
        visibility === 'hidden' ? 'author_hidden' : 'author_listed',
        reason,
        requestId,
      );
    });
    return {
      data: {
        message:
          visibility === 'hidden'
            ? '作品已隐藏，历史版本、图片和导出入口同步受限'
            : '作品已恢复展示，管理员封禁仍按原状态生效',
      },
    };
  }
  async rollback(
    actor: Identity,
    id: string,
    releaseId: string,
    reason: string,
    requestId: string,
  ) {
    await this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      await assertOrdinaryWriteAllowed(tx);
      const persona = await lockPersona(tx, id, actor.account.id);
      if (persona.moderationState === 'blocked')
        throw new BusinessError('FORBIDDEN', '封禁作品不能切换公开版本');
      const [release] = await tx
        .select()
        .from(personaReleases)
        .where(and(eq(personaReleases.id, releaseId), eq(personaReleases.personaId, id)))
        .for('update');
      if (!release || release.lifecycle !== 'PUBLISHED' || !release.approvedSubmissionId)
        throw new BusinessError('CONFLICT', '只能选择本作品仍有效的已发布版本');
      await tx
        .update(personas)
        .set({ publishedReleaseId: releaseId, revision: sql`${personas.revision}+1` })
        .where(eq(personas.id, id));
      await updateProjection(tx, id, releaseId);
      await recordAction(tx, actor, id, 'public_version_selected', reason, requestId);
    });
    return { data: { message: '当前展示版本已切换，版本历史保持原样' } };
  }
  async moderatePersona(
    actor: Identity,
    id: string,
    input: z.infer<typeof PersonaModerationSchema>,
    key: string,
    requestId: string,
  ) {
    const replayed = await administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const operation = 'persona.moderation';
        const command = { id: id.toLowerCase(), ...input };
        const previous = await idempotentResult(tx, actor, operation, key, command);
        if (previous) {
          if (previous.toLowerCase() !== id.toLowerCase())
            throw new BusinessError('CONFLICT', '操作记录不可用，请重新核对人设');
          return true;
        }
        await applyPersonaModeration(tx, actor, id, input, requestId);
        await rememberResult(tx, actor, operation, key, command, id);
        return false;
      },
      { area: 'personas', serializeWrites: true },
    );
    return {
      data: {
        message: replayed
          ? '这次操作已处理，请核对当前人设状态'
          : input.state === 'blocked'
            ? '作品已封禁，所有公开入口同步受限'
            : '作品封禁已解除，作者隐藏状态保持原样',
      },
    };
  }
  async deletePersona(
    actor: Identity,
    id: string,
    expectedRevision: number,
    key: string,
    requestId: string,
  ) {
    await administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const operation = 'persona.delete';
        const command = { id, expectedRevision };
        if (await idempotentResult(tx, actor, operation, key, command)) return;
        const persona = await lockPersona(tx, id);
        if (persona.revision !== expectedRevision)
          throw new BusinessError('REVISION_CONFLICT', '人设状态已变化，请重新核对');
        await removePersonas(tx, actor, sql`id=${id}`, requestId);
        await rememberResult(tx, actor, operation, key, command, id);
      },
      { area: 'personas', serializeWrites: true },
    );
    return { data: { message: '人设已删除' } };
  }
  async releaseAction(
    actor: Identity,
    id: string,
    releaseId: string,
    action: 'withdraw' | 'block' | 'restore',
    reason: string,
    requestId: string,
  ) {
    await administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, action !== 'withdraw', false);
        if (action === 'withdraw') await assertOrdinaryWriteAllowed(tx);
        await applyReleaseModeration(tx, actor, id, releaseId, action, reason, requestId);
      },
      { area: 'personas', serializeWrites: true },
    );
    return { data: { message: '版本状态已更新，当前版本失效时不会自动切换到旧版' } };
  }
}
