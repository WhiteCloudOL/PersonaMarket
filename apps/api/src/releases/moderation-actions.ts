import { and, eq, sql } from 'drizzle-orm';
import { personas, personaReleases, users } from '@personamarket/database';
import { BusinessError } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { lockPersona, recordAction, updateProjection } from './release-helpers.js';

async function lockOwner(tx: Transaction, id: string) {
  const [row] = await tx
    .select({ ownerId: personas.ownerId })
    .from(personas)
    .where(eq(personas.id, id));
  if (!row) throw new BusinessError('NOT_FOUND', '人设不存在或不可访问');
  // FK写入通知需要收件人的key-share锁，必须在作品锁之前取得兼容的用户锁
  await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, row.ownerId))
    .for('no key update');
}

/** 调用方持有管理锁并校验身份，复用同一事务中的状态、记录及Outbox */
export async function applyPersonaModeration(
  tx: Transaction,
  actor: Identity,
  id: string,
  input: { state: 'normal' | 'blocked'; expectedRevision: number; reason: string },
  requestId: string,
  selfReview = false,
) {
  await lockOwner(tx, id);
  const persona = await lockPersona(tx, id);
  if (persona.revision !== input.expectedRevision)
    throw new BusinessError('REVISION_CONFLICT', '人设状态已变化，请读取最新状态后核对');
  if (persona.moderationState === input.state)
    throw new BusinessError('CONFLICT', '人设已处于所选状态，请核对当前状态');
  await tx
    .update(personas)
    .set({
      moderationState: input.state,
      revision: sql`${personas.revision}+1`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(eq(personas.id, id));
  const recordId = await recordAction(
    tx,
    actor,
    id,
    input.state === 'blocked' ? 'persona_blocked' : 'persona_unblocked',
    input.reason,
    requestId,
    undefined,
    selfReview,
  );
  return {
    recordId,
    resourceId: id,
    beforeRevision: persona.revision,
    afterRevision: persona.revision + 1,
  };
}

export async function applyReleaseModeration(
  tx: Transaction,
  actor: Identity,
  id: string,
  releaseId: string,
  action: 'withdraw' | 'block' | 'restore',
  reason: string,
  requestId: string,
  expectedRevision?: number,
  selfReview = false,
) {
  await lockOwner(tx, id);
  const persona = await lockPersona(tx, id, action === 'withdraw' ? actor.account.id : undefined);
  const [release] = await tx
    .select()
    .from(personaReleases)
    .where(and(eq(personaReleases.id, releaseId), eq(personaReleases.personaId, id)))
    .for('update');
  if (!release?.publishedAt) throw new BusinessError('CONFLICT', '只能处理已发布的版本');
  if (expectedRevision !== undefined && release.moderationRevision !== expectedRevision)
    throw new BusinessError('REVISION_CONFLICT', '版本状态已变化，请重新核对');
  if (
    (action === 'restore' && release.lifecycle !== 'BLOCKED') ||
    (action !== 'restore' && release.lifecycle !== 'PUBLISHED')
  )
    throw new BusinessError('CONFLICT', '版本状态已变化，请刷新后重试');
  if (action !== 'restore' && persona.publishedReleaseId === releaseId) {
    await tx
      .update(personas)
      .set({ publishedReleaseId: null, revision: sql`${personas.revision}+1` })
      .where(eq(personas.id, id));
    await updateProjection(tx, id, null);
  }
  const [updated] = await tx
    .update(personaReleases)
    .set({
      lifecycle: action === 'restore' ? 'PUBLISHED' : action === 'block' ? 'BLOCKED' : 'WITHDRAWN',
    })
    .where(eq(personaReleases.id, releaseId))
    .returning({ revision: personaReleases.moderationRevision });
  if (!updated) throw new BusinessError('CONFLICT', '版本状态已变化，请重新核对');
  const recordId = await recordAction(
    tx,
    actor,
    id,
    'release_' + action,
    reason,
    requestId,
    release.approvedSubmissionId ?? undefined,
    selfReview,
  );
  return {
    recordId,
    resourceId: releaseId,
    beforeRevision: release.moderationRevision,
    afterRevision: updated.revision,
  };
}
