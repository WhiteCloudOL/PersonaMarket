import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  notifications,
  notificationPreferences,
  authAuditEvents,
  type Database,
} from '@personamarket/database';
import {
  NotificationCountResponseSchema,
  NotificationsResponseSchema,
  NotificationReadResponseSchema,
  NotificationPayloadSchema,
  NotificationPreferencesResponseSchema,
  type UpdateNotificationPreferences,
  type NotificationsQuery,
} from '@personamarket/contracts';
import {
  BusinessError,
  notificationTargetKey,
  resolveNotificationTargets,
  assertOrdinaryWriteAllowed,
} from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import type { Identity } from '../auth/auth.service.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import { administrationTransaction } from '../admin/administration-transaction.js';

const delivered = (accountId: string) =>
  and(eq(notifications.recipientId, accountId), eq(notifications.status, 'delivered'));
const notFound = () => new BusinessError('NOT_FOUND', '通知不存在或暂不可读取');
async function counts(tx: Transaction, accountId: string) {
  const [unread] = await tx
    .select({ amount: count() })
    .from(notifications)
    .where(and(delivered(accountId), isNull(notifications.readAt)));
  const [latest] = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(delivered(accountId))
    .orderBy(desc(notifications.deliveredAt), desc(notifications.id))
    .limit(1);
  return { unreadCount: unread?.amount ?? 0, throughId: latest?.id ?? null };
}
@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private transaction<T>(actor: Identity, operation: (tx: Transaction) => Promise<T>) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, false, false);
        return operation(tx);
      },
      { area: 'content' },
    );
  }
  counts(actor: Identity) {
    return this.transaction(actor, async (tx) =>
      NotificationCountResponseSchema.parse({ data: await counts(tx, actor.account.id) }),
    );
  }
  preferences(actor: Identity) {
    return this.transaction(actor, async (tx) => {
      const [row] = await tx
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, actor.account.id));
      return NotificationPreferencesResponseSchema.parse({
        data: row
          ? { reviewEmail: row.reviewEmail, revision: row.revision }
          : { reviewEmail: true, revision: 0 },
      });
    });
  }
  updatePreferences(actor: Identity, input: UpdateNotificationPreferences, requestId: string) {
    return this.transaction(actor, async (tx) => {
      await assertOrdinaryWriteAllowed(tx);
      const [current] = await tx
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, actor.account.id));
      if ((current?.revision ?? 0) !== input.expectedRevision)
        throw new BusinessError('REVISION_CONFLICT', '通知偏好已更新，请读取最新设置后核对');
      const [saved] = await tx
        .insert(notificationPreferences)
        .values({
          userId: actor.account.id,
          reviewEmail: input.reviewEmail,
          revision: 1,
        })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: {
            reviewEmail: input.reviewEmail,
            revision: sql`${notificationPreferences.revision}+1`,
            updatedAt: sql`clock_timestamp()`,
          },
          setWhere: eq(notificationPreferences.revision, input.expectedRevision),
        })
        .returning();
      if (!saved)
        throw new BusinessError('REVISION_CONFLICT', '通知偏好已更新，请读取最新设置后核对');
      await tx
        .insert(authAuditEvents)
        .values({ userId: actor.account.id, event: 'notification.preferences_updated', requestId });
      return NotificationPreferencesResponseSchema.parse({
        data: { reviewEmail: saved.reviewEmail, revision: saved.revision },
      });
    });
  }
  list(actor: Identity, input: NotificationsQuery) {
    return this.transaction(actor, async (tx) => {
      const condition = and(
        delivered(actor.account.id),
        input.status === 'unread' ? isNull(notifications.readAt) : undefined,
      );
      const rows = await tx
        .select()
        .from(notifications)
        .where(condition)
        .orderBy(desc(notifications.deliveredAt), desc(notifications.id))
        .limit(20)
        .offset((input.page - 1) * 20);
      const [total] = await tx.select({ amount: count() }).from(notifications).where(condition);
      const payloads = rows.map((row) =>
        NotificationPayloadSchema.parse({
          recipientId: row.recipientId,
          actorId: row.actorId,
          sourceId: row.sourceId,
          kind: row.kind,
          title: row.title,
          message: row.message,
          target: row.target,
        }),
      );
      const destinations = await resolveNotificationTargets(
        tx,
        actor.account.id,
        payloads.map((payload) => payload.target),
      );
      return NotificationsResponseSchema.parse({
        data: rows.map((row, index) => {
          const payload = payloads[index];
          if (!payload || !row.deliveredAt)
            throw new BusinessError('INVALID_RESPONSE', '通知暂时无法读取');
          const destination = destinations.get(notificationTargetKey(payload.target));
          if (!destination) throw new BusinessError('INVALID_RESPONSE', '通知目标暂时无法核对');
          return {
            id: row.id,
            kind: payload.kind,
            title: payload.title,
            message: payload.message,
            createdAt: row.deliveredAt.toISOString(),
            readAt: row.readAt?.toISOString() ?? null,
            ...destination,
          };
        }),
        meta: {
          page: input.page,
          pageSize: 20,
          total: total?.amount ?? 0,
          ...(await counts(tx, actor.account.id)),
        },
      });
    });
  }
  readOne(actor: Identity, id: string) {
    return this.transaction(actor, async (tx) => {
      await assertOrdinaryWriteAllowed(tx);
      const [row] = await tx
        .select({ readAt: notifications.readAt })
        .from(notifications)
        .where(and(delivered(actor.account.id), eq(notifications.id, id)))
        .for('update');
      if (!row) throw notFound();
      if (row.readAt) return NotificationReadResponseSchema.parse({ data: { updated: 0 } });
      await tx
        .update(notifications)
        .set({ readAt: sql`clock_timestamp()` })
        .where(eq(notifications.id, id));
      return NotificationReadResponseSchema.parse({ data: { updated: 1 } });
    });
  }
  readAll(actor: Identity, throughId: string) {
    return this.transaction(actor, async (tx) => {
      await assertOrdinaryWriteAllowed(tx);
      const [boundary] = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(delivered(actor.account.id), eq(notifications.id, throughId)));
      if (!boundary) throw notFound();
      // 在数据库内比较完整精度的送达时间和ID，不经JS Date截断微秒；后来送达的消息保持未读
      const result = await tx.execute<{ updated: number }>(sql`WITH changed AS (
        UPDATE notifications SET read_at=clock_timestamp()
        WHERE recipient_id=${actor.account.id} AND status='delivered' AND read_at IS NULL
          AND (delivered_at,id)<=(SELECT cutoff.delivered_at,cutoff.id FROM notifications cutoff WHERE cutoff.id=${throughId} AND cutoff.recipient_id=${actor.account.id} AND cutoff.status='delivered')
        RETURNING 1
      ) SELECT count(*)::integer AS updated FROM changed`);
      const row = result.rows[0];
      if (!row) throw new BusinessError('INVALID_RESPONSE', '已读状态暂时无法核对');
      return NotificationReadResponseSchema.parse({ data: row });
    });
  }
}
