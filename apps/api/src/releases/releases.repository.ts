import { Inject, Injectable } from '@nestjs/common';
import { and, eq, desc, sql, max, inArray } from 'drizzle-orm';
import {
  personas,
  personaDrafts,
  personaReleases,
  releaseSubmissions,
  siteSettings,
  categories,
  tags,
  assetReferences,
  type Database,
} from '@personamarket/database';
import {
  PersonaDraftSchema,
  ContentLimitsSchema,
  SubmissionSettingsSchema,
  SubmissionPendingHintResponseSchema,
  createPublicSnapshotSchema,
  PublicSnapshotSchema,
  publicSnapshotCandidate,
  type CreateReleaseSchema,
  type RestoreSubmissionSchema,
} from '@personamarket/contracts';
import {
  BusinessError,
  assertOrdinaryWriteAllowed,
  assertReadmeImages,
  readMediaSettings,
  contentHash,
  type ServerEnvironment,
} from '@personamarket/server';
import type { z } from 'zod';
import { DATABASE, ENVIRONMENT } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { validateDraftAssets, setDraftAssetReferences } from '../assets/asset-links.js';
import {
  lockPersona,
  lockSubmission,
  idempotentResult,
  rememberResult,
  recordAction,
  notifyOwner,
  submissionView,
} from './release-helpers.js';
@Injectable()
export class ReleasesRepository {
  constructor(
    @Inject(DATABASE) readonly database: Database,
    @Inject(ENVIRONMENT) private readonly env: ServerEnvironment,
  ) {}
  async readSubmission(id: string) {
    const [row] = await this.database.db
      .select({
        submission: releaseSubmissions,
        release: personaReleases,
        currentId: personas.publishedReleaseId,
      })
      .from(releaseSubmissions)
      .innerJoin(personaReleases, eq(personaReleases.id, releaseSubmissions.releaseId))
      .innerJoin(personas, eq(personas.id, releaseSubmissions.personaId))
      .where(eq(releaseSubmissions.id, id));
    if (!row) throw new BusinessError('NOT_FOUND', '提交不存在或不可访问');
    return submissionView(row.submission, row.release, row.currentId);
  }
  async ownList(actor: Identity, id: string, page: number) {
    const persona = await this.database.db.query.personas.findFirst({
      where: and(eq(personas.id, id), eq(personas.ownerId, actor.account.id)),
    });
    if (!persona) throw new BusinessError('NOT_FOUND', '人设不存在或不可访问');
    const rows = await this.database.db
      .select({ submission: releaseSubmissions, release: personaReleases })
      .from(releaseSubmissions)
      .innerJoin(personaReleases, eq(personaReleases.id, releaseSubmissions.releaseId))
      .where(eq(releaseSubmissions.personaId, id))
      .orderBy(desc(releaseSubmissions.createdAt), desc(releaseSubmissions.id))
      .limit(20)
      .offset((page - 1) * 20);
    return {
      data: rows.map((row) =>
        submissionView(row.submission, row.release, persona.publishedReleaseId),
      ),
    };
  }
  async pendingHint(actor: Identity, id: string) {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout='2s'`);
      await lockIdentity(tx, actor, false, false);
      const [submission] = await tx
        .select({ id: releaseSubmissions.id })
        .from(releaseSubmissions)
        .innerJoin(personas, eq(personas.id, releaseSubmissions.personaId))
        .where(
          and(
            eq(releaseSubmissions.id, id),
            eq(personas.ownerId, actor.account.id),
            eq(releaseSubmissions.status, 'PENDING'),
          ),
        )
        .limit(1)
        .for('share', { of: releaseSubmissions });
      if (!submission)
        throw new BusinessError('NOT_FOUND', '待审提交不存在或审核状态已更新，请重新读取发布记录');
      const [settings] = await tx
        .select()
        .from(siteSettings)
        .where(eq(siteSettings.key, 'submissions'));
      if (!settings) throw new BusinessError('SERVICE_UNAVAILABLE', '投稿提示尚未完成初始化');
      const value = SubmissionSettingsSchema.safeParse(settings.value);
      if (!value.success)
        throw new BusinessError('INVALID_RESPONSE', '投稿提示暂时不可用，请联系管理员', {
          cause: value.error,
        });
      return SubmissionPendingHintResponseSchema.parse({
        data: { submissionId: submission.id, pendingHint: value.data.pendingHint },
        meta: { settingsRevision: settings.revision },
      });
    });
  }
  async create(
    actor: Identity,
    id: string,
    input: z.infer<typeof CreateReleaseSchema>,
    key: string,
    requestId: string,
  ) {
    const submissionId = await this.database.db.transaction(async (tx) => {
      const { account } = await lockIdentity(tx, actor, false, false);
      if (!account.emailVerifiedAt)
        throw new BusinessError('FORBIDDEN', '请先验证邮箱后再提交作品');
      const retry = await idempotentResult(tx, actor, 'release.create', key, { id, ...input });
      if (retry) return retry;
      await assertOrdinaryWriteAllowed(tx);
      const persona = await lockPersona(tx, id, actor.account.id);
      if (persona.moderationState === 'blocked')
        throw new BusinessError('FORBIDDEN', '作品已被封禁，请联系管理员');
      const settingRows = await tx
        .select()
        .from(siteSettings)
        .where(inArray(siteSettings.key, ['submissions', 'contentLimits']))
        .for('share');
      const submissions = SubmissionSettingsSchema.parse(
        settingRows.find((row) => row.key === 'submissions')?.value,
      );
      if (!submissions.enabled || !submissions.platforms.includes(persona.platform))
        throw new BusinessError('FORBIDDEN', '投稿暂未开放，请稍后再来');
      const daily = await tx
        .select({ value: sql<number>`count(*)::integer` })
        .from(releaseSubmissions)
        .where(
          and(
            eq(releaseSubmissions.submittedBy, account.id),
            sql`${releaseSubmissions.createdAt} >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
          ),
        );
      if ((daily[0]?.value ?? 0) >= submissions.dailyQuota)
        throw new BusinessError('RATE_LIMITED', '今日投稿数量已达上限，请明天再来');
      const limits = ContentLimitsSchema.parse(
        settingRows.find((row) => row.key === 'contentLimits')?.value,
      );
      const [draftRow] = await tx
        .select()
        .from(personaDrafts)
        .where(eq(personaDrafts.personaId, id))
        .for('update');
      if (!draftRow || draftRow.revision !== input.expectedDraftRevision)
        throw new BusinessError('REVISION_CONFLICT', '草稿已变化，请保存最新内容后重新确认发版');
      const draft = PersonaDraftSchema.parse(draftRow.payload);
      if (!draft.rightsAccepted)
        throw new BusinessError('VALIDATION_FAILED', '请先确认作品的展示与复制下载授权', {
          fieldErrors: [{ path: 'rightsAccepted', message: '请确认展示与复制下载授权' }],
        });
      const checked = createPublicSnapshotSchema(limits).safeParse(publicSnapshotCandidate(draft));
      if (!checked.success)
        throw new BusinessError('VALIDATION_FAILED', '请补齐必填信息并修正超限内容后再提交', {
          fieldErrors: checked.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      const snapshot = checked.data;
      const media = await readMediaSettings(tx, true);
      assertReadmeImages(snapshot.readmeMarkdown, media.maxReadmeImages);
      const ids = await validateDraftAssets(tx, actor.account.id, draft);
      const [category] = await tx
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(and(eq(categories.id, snapshot.categoryId), eq(categories.active, true)))
        .for('share');
      if (!category) throw new BusinessError('VALIDATION_FAILED', '请选择有效分类');
      const tagRows = snapshot.tagIds.length
        ? await tx
            .select({ id: tags.id, name: tags.name })
            .from(tags)
            .where(and(inArray(tags.id, snapshot.tagIds), eq(tags.active, true)))
            .for('share')
        : [];
      if (tagRows.length !== snapshot.tagIds.length)
        throw new BusinessError('VALIDATION_FAILED', '存在已停用的标签，请重新选择');
      const [pending] = await tx
        .select({ id: releaseSubmissions.id })
        .from(releaseSubmissions)
        .where(and(eq(releaseSubmissions.personaId, id), eq(releaseSubmissions.status, 'PENDING')));
      if (pending) throw new BusinessError('CONFLICT', '已有待审核版本，请先等待处理或撤回');
      const [major = 0, minor = 0, patch = 0] = input.version.split('.').map(Number);
      const [highest] = await tx
        .select()
        .from(personaReleases)
        .where(
          and(eq(personaReleases.personaId, id), sql`${personaReleases.publishedAt} IS NOT NULL`),
        )
        .orderBy(
          desc(personaReleases.major),
          desc(personaReleases.minor),
          desc(personaReleases.patch),
        )
        .limit(1);
      if (
        highest &&
        (major < highest.major ||
          (major === highest.major &&
            (minor < highest.minor || (minor === highest.minor && patch <= highest.patch))))
      )
        throw new BusinessError('CONFLICT', '版本号必须高于历史最高已发布版本');
      let [release] = await tx
        .select()
        .from(personaReleases)
        .where(and(eq(personaReleases.personaId, id), eq(personaReleases.version, input.version)))
        .for('update');
      if (release?.publishedAt) throw new BusinessError('CONFLICT', '已发布版本号不能复用');
      if (!release)
        [release] = await tx
          .insert(personaReleases)
          .values({ personaId: id, version: input.version, major, minor, patch })
          .returning();
      if (!release) throw new Error('RELEASE_INSERT_FAILED');
      const [attempt] = await tx
        .select({ value: max(releaseSubmissions.attemptNumber) })
        .from(releaseSubmissions)
        .where(eq(releaseSubmissions.releaseId, release.id));
      const publication = {
        publisher: account.username,
        category,
        tags: tagRows.sort((a, b) => snapshot.tagIds.indexOf(a.id) - snapshot.tagIds.indexOf(b.id)),
      };
      const [submission] = await tx
        .insert(releaseSubmissions)
        .values({
          personaId: id,
          releaseId: release.id,
          submittedBy: account.id,
          attemptNumber: (attempt?.value ?? 0) + 1,
          snapshot,
          publication,
          changelog: input.changelog,
          contentHash: contentHash({ snapshot, publication, changelog: input.changelog }),
        })
        .returning();
      if (!submission) throw new Error('SUBMISSION_INSERT_FAILED');
      for (const purpose of ['content', 'evidence'] as const)
        if (ids[purpose].length)
          await tx.insert(assetReferences).values(
            ids[purpose].map((assetId) => ({
              assetId,
              personaId: id,
              resourceType: 'submission' as const,
              resourceId: submission.id,
              purpose,
            })),
          );
      await recordAction(tx, actor, id, 'submitted', input.changelog, requestId, submission.id);
      await notifyOwner(
        tx,
        persona,
        this.env.APP_ENCRYPTION_KEY,
        '人设版本已提交审核',
        snapshot.title + ' ' + input.version + ' 已提交审核，继续编辑草稿不会改变本次快照',
      );
      await rememberResult(tx, actor, 'release.create', key, { id, ...input }, submission.id);
      return submission.id;
    });
    return { data: await this.readSubmission(submissionId) };
  }
  async withdraw(
    actor: Identity,
    submissionId: string,
    expected: number,
    reason: string,
    requestId: string,
  ) {
    const original = await this.readSubmission(submissionId);
    await this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      await assertOrdinaryWriteAllowed(tx);
      await lockPersona(tx, original.personaId, actor.account.id);
      const submission = await lockSubmission(tx, submissionId);
      if (submission.status !== 'PENDING' || submission.revision !== expected)
        throw new BusinessError('CONFLICT', '提交已被处理，请刷新状态');
      await tx
        .update(releaseSubmissions)
        .set({ status: 'WITHDRAWN', reason, revision: submission.revision + 1 })
        .where(eq(releaseSubmissions.id, submissionId));
      await recordAction(
        tx,
        actor,
        submission.personaId,
        'submission_withdrawn',
        reason,
        requestId,
        submissionId,
      );
    });
    return { data: await this.readSubmission(submissionId) };
  }
  async restore(
    actor: Identity,
    id: string,
    input: z.infer<typeof RestoreSubmissionSchema>,
    requestId: string,
  ) {
    return this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      await assertOrdinaryWriteAllowed(tx);
      await lockPersona(tx, id, actor.account.id);
      const submission = await lockSubmission(tx, input.submissionId);
      if (submission.personaId !== id) throw new BusinessError('NOT_FOUND', '提交不存在或不可访问');
      const [row] = await tx
        .select()
        .from(personaDrafts)
        .where(eq(personaDrafts.personaId, id))
        .for('update');
      if (!row || row.revision !== input.expectedDraftRevision)
        throw new BusinessError('REVISION_CONFLICT', '当前草稿已变化，请备份编辑后重新确认');
      const previous = PersonaDraftSchema.parse(row.payload);
      const snapshot = PublicSnapshotSchema.parse(submission.snapshot);
      const proofs = await tx
        .select({ id: assetReferences.assetId })
        .from(assetReferences)
        .where(
          and(
            eq(assetReferences.resourceType, 'submission'),
            eq(assetReferences.resourceId, submission.id),
            eq(assetReferences.purpose, 'evidence'),
          ),
        );
      const payload = PersonaDraftSchema.parse({
        ...snapshot,
        authorNotes: snapshot.authorNotes ?? '',
        rightsAccepted: previous.rightsAccepted,
        evidenceAssetIds: proofs.map((proof) => proof.id),
      });
      await setDraftAssetReferences(tx, actor.account.id, id, payload);
      await tx
        .update(personaDrafts)
        .set({ payload, revision: row.revision + 1, updatedAt: new Date() })
        .where(eq(personaDrafts.personaId, id));
      await recordAction(
        tx,
        actor,
        id,
        'restored_to_draft',
        '作者明确确认复制历史快照到草稿',
        requestId,
        submission.id,
      );
      return { data: { message: '快照已复制到草稿，请重新打开编辑器' } };
    });
  }
}
