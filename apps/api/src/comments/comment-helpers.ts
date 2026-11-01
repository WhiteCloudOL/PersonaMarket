import { and, eq, sql } from 'drizzle-orm';
import {
  comments,
  personas,
  personaReleases,
  releaseSubmissions,
  siteSettings,
  type Database,
} from '@personamarket/database';
import { InteractionSettingsSchema } from '@personamarket/contracts';
import { BusinessError, publicCurrentCondition } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';

export type CommentRow = typeof comments.$inferSelect;
export async function commentTransaction<T>(
  database: Database,
  operation: (tx: Transaction) => Promise<T>,
  readOnly = false,
) {
  try {
    return await database.db.transaction<T>(
      async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout='3s'`);
        return operation(tx);
      },
      readOnly ? { isolationLevel: 'repeatable read', accessMode: 'read only' } : undefined,
    );
  } catch (cause) {
    let current: unknown = cause;
    for (let depth = 0; depth < 6 && current instanceof Error; depth++) {
      if ('code' in current && ['57014', '55P03'].includes(String(current.code)))
        throw new BusinessError('SERVICE_UNAVAILABLE', '评论服务繁忙，请稍后重试', {
          cause,
          retryAfterSeconds: 1,
        });
      current = current.cause;
    }
    throw cause;
  }
}

export async function commentSettings(tx: Transaction, lock = false) {
  const query = tx.select().from(siteSettings).where(eq(siteSettings.key, 'community'));
  const [row] = lock ? await query.for('share') : await query;
  return InteractionSettingsSchema.parse(row?.value);
}

export async function commentPersona(tx: Transaction, id: string, lock = false) {
  if (lock) {
    const [row] = await tx
      .select({ id: personas.id })
      .from(personas)
      .where(eq(personas.id, id))
      .for('update');
    if (!row) throw new BusinessError('NOT_FOUND', '人设不存在或暂不可公开');
  }
  const [row] = await tx
    .select({ id: personas.id, ownerId: personas.ownerId, releaseId: personas.publishedReleaseId })
    .from(personas)
    .innerJoin(
      personaReleases,
      and(
        eq(personas.id, personaReleases.personaId),
        eq(personas.publishedReleaseId, personaReleases.id),
      ),
    )
    .innerJoin(
      releaseSubmissions,
      and(
        eq(releaseSubmissions.id, personaReleases.approvedSubmissionId),
        eq(releaseSubmissions.personaId, personas.id),
        eq(releaseSubmissions.releaseId, personaReleases.id),
      ),
    )
    .where(and(eq(personas.id, id), publicCurrentCondition));
  if (!row?.releaseId) throw new BusinessError('NOT_FOUND', '人设不存在或暂不可公开');
  return row;
}

export async function commentRelease(tx: Transaction, personaId: string, releaseId: string) {
  const [row] = await tx
    .select({ id: personaReleases.id })
    .from(personaReleases)
    .innerJoin(
      releaseSubmissions,
      and(
        eq(releaseSubmissions.id, personaReleases.approvedSubmissionId),
        eq(releaseSubmissions.personaId, personaReleases.personaId),
        eq(releaseSubmissions.releaseId, personaReleases.id),
      ),
    )
    .where(
      and(
        eq(personaReleases.id, releaseId),
        eq(personaReleases.personaId, personaId),
        eq(personaReleases.lifecycle, 'PUBLISHED'),
        eq(releaseSubmissions.status, 'APPROVED'),
      ),
    );
  if (!row) throw new BusinessError('NOT_FOUND', '评论引用的版本不存在或暂不可公开');
}

export async function lockedComment(tx: Transaction, id: string) {
  const [row] = await tx.select().from(comments).where(eq(comments.id, id)).for('update');
  if (!row) throw new BusinessError('NOT_FOUND', '评论不存在或不可访问');
  return row;
}
