import { and, eq, sql, isNull } from 'drizzle-orm';
import { buildPublicSearchProjection } from '@personamarket/persona-adapters';
import {
  personas,
  personaReleases,
  releaseSubmissions,
  moderationRecords,
  idempotencyKeys,
  personaPublicProjection,
} from '@personamarket/database';
import {
  PublicSnapshotSchema,
  PublicationSchema,
  SubmissionSchema,
} from '@personamarket/contracts';
import { BusinessError, contentHash, enqueueNotification } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { notifyReviewEmail } from '../notifications/review-email.js';
export type PersonaRow = typeof personas.$inferSelect;
export type SubmissionRow = typeof releaseSubmissions.$inferSelect;
export function submissionView(
  row: SubmissionRow,
  release: typeof personaReleases.$inferSelect,
  currentId: string | null,
) {
  return SubmissionSchema.parse({
    id: row.id,
    personaId: row.personaId,
    releaseId: row.releaseId,
    attemptNumber: row.attemptNumber,
    status: row.status,
    revision: row.revision,
    changelog: row.changelog,
    contentHash: row.contentHash,
    reason: row.reason,
    version: release.version,
    releaseLifecycle: release.lifecycle,
    current: currentId === release.id,
    publishedAt: release.publishedAt?.toISOString() ?? null,
    snapshot: PublicSnapshotSchema.parse(row.snapshot),
    publication: PublicationSchema.parse(row.publication),
    createdAt: row.createdAt.toISOString(),
  });
}
export async function lockPersona(tx: Transaction, id: string, ownerId?: string) {
  const [persona] = await tx
    .select()
    .from(personas)
    .where(ownerId ? and(eq(personas.id, id), eq(personas.ownerId, ownerId)) : eq(personas.id, id))
    .for('update');
  if (!persona) throw new BusinessError('NOT_FOUND', '人设不存在或不可访问');
  return persona;
}
export async function lockSubmission(tx: Transaction, id: string) {
  const [submission] = await tx
    .select()
    .from(releaseSubmissions)
    .where(eq(releaseSubmissions.id, id))
    .for('update');
  if (!submission) throw new BusinessError('NOT_FOUND', '提交不存在或不可访问');
  return submission;
}
export async function idempotentResult(
  tx: Transaction,
  actor: Identity,
  operation: string,
  key: string,
  input: unknown,
) {
  const [previous] = await tx
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.actorId, actor.account.id),
        eq(idempotencyKeys.operation, operation),
        eq(idempotencyKeys.key, key),
      ),
    );
  if (previous && previous.requestHash !== contentHash(input))
    throw new BusinessError('CONFLICT', '同一幂等标识对应不同请求，请重新确认操作');
  return previous?.resultId;
}
export async function rememberResult(
  tx: Transaction,
  actor: Identity,
  operation: string,
  key: string,
  input: unknown,
  resultId: string,
) {
  await tx.insert(idempotencyKeys).values({
    actorId: actor.account.id,
    operation,
    key,
    requestHash: contentHash(input),
    resultId,
  });
}
export async function recordAction(
  tx: Transaction,
  actor: Identity,
  personaId: string,
  action: string,
  reason: string,
  requestId: string,
  submissionId?: string,
  selfReview = false,
) {
  const [record] = await tx
    .insert(moderationRecords)
    .values({
      actorId: actor.account.id,
      personaId,
      action,
      reason,
      requestId,
      selfReview,
      ...(submissionId ? { submissionId } : {}),
    })
    .returning({ id: moderationRecords.id });
  if (!record) throw new Error('MODERATION_RECORD_INSERT_FAILED');
  const titles: Readonly<Record<string, string>> = {
    approved: '作品审核通过',
    rejected: '作品需要修改',
    persona_blocked: '作品已被管理下架',
    persona_unblocked: '作品管理限制已解除',
    release_block: '作品版本已被管理限制',
    release_restore: '作品版本已恢复',
    release_withdraw: '作品版本已撤下',
    author_hidden: '作品已隐藏',
    author_listed: '作品已重新展示',
    public_version_selected: '作品展示版本已切换',
    submission_withdrawn: '作品审核已撤回',
  };
  const title = titles[action];
  if (title) {
    const [persona] = await tx
      .select({ ownerId: personas.ownerId })
      .from(personas)
      .where(eq(personas.id, personaId));
    if (!persona) throw new Error('NOTIFICATION_PERSONA_MISSING');
    await enqueueNotification(tx, {
      recipientId: persona.ownerId,
      actorId: actor.account.id,
      sourceId: record.id,
      kind:
        action === 'approved'
          ? 'release_approved'
          : action === 'rejected'
            ? 'release_rejected'
            : 'persona_state',
      title,
      message: '你的作品状态有更新，可以在版本管理中查看具体记录和处理说明',
      target: { type: 'own_persona', personaId },
    });
  }
  return record.id;
}
export async function updateProjection(
  tx: Transaction,
  personaId: string,
  releaseId: string | null,
) {
  if (!releaseId) {
    await tx
      .delete(personaPublicProjection)
      .where(eq(personaPublicProjection.personaId, personaId));
    return;
  }
  const [row] = await tx
    .select({ snapshot: releaseSubmissions.snapshot, publication: releaseSubmissions.publication })
    .from(personaReleases)
    .innerJoin(releaseSubmissions, eq(personaReleases.approvedSubmissionId, releaseSubmissions.id))
    .where(
      and(
        eq(personaReleases.id, releaseId),
        eq(personaReleases.personaId, personaId),
        eq(personaReleases.lifecycle, 'PUBLISHED'),
        eq(releaseSubmissions.status, 'APPROVED'),
      ),
    );
  if (!row) throw new BusinessError('CONFLICT', '公开版本不可用，请刷新后重试');
  const fields = buildPublicSearchProjection(row.snapshot, row.publication);
  await tx
    .update(personas)
    .set({
      firstPublishedAt: sql`(SELECT min(published_at) FROM persona_releases WHERE persona_id=${personaId} AND published_at IS NOT NULL)`,
    })
    .where(and(eq(personas.id, personaId), isNull(personas.firstPublishedAt)));
  await tx
    .insert(personaPublicProjection)
    .values({
      personaId,
      releaseId,
      searchReleaseId: releaseId,
      ...fields,
    })
    .onConflictDoUpdate({
      target: personaPublicProjection.personaId,
      set: {
        releaseId,
        searchReleaseId: releaseId,
        ...fields,
        updatedAt: new Date(),
      },
    });
}
export async function notifyOwner(
  tx: Transaction,
  persona: PersonaRow,
  key: string,
  subject: string,
  text: string,
) {
  await notifyReviewEmail(tx, persona.ownerId, key, subject, text, persona.id);
}
