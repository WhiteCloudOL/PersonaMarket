import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { notifications, outboxEvents, users } from '@personamarket/database';
import { AdminNoticeSchema } from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';

export const noticeActor = alias(users, 'notice_actor');
export const noticeFields = {
  entry: notifications,
  outboxAttempts: outboxEvents.attempts,
  enqueuedAt: outboxEvents.deliveredAt,
  leaseExpired: sql<boolean>`${outboxEvents.leaseUntil} IS NULL OR ${outboxEvents.leaseUntil}<=clock_timestamp()`,
  actor: { id: noticeActor.id, username: noticeActor.username },
  recipient: { id: users.id, username: users.username },
};
type NoticeRow = {
  entry: typeof notifications.$inferSelect;
  outboxAttempts: number;
  enqueuedAt: Date | null;
  leaseExpired: boolean;
  actor: { id: string; username: string };
  recipient: { id: string; username: string };
};
export const effectiveNoticeStatus = sql<string>`CASE WHEN ${notifications.status}='queued' AND ${outboxEvents.attempts}>=5 AND ${outboxEvents.deliveredAt} IS NULL AND (${outboxEvents.leaseUntil} IS NULL OR ${outboxEvents.leaseUntil}<=clock_timestamp()) THEN 'failed' ELSE ${notifications.status} END`;
export function noticeView(row: NoticeRow) {
  const dispatchFailed =
    row.entry.status === 'queued' && row.outboxAttempts >= 5 && !row.enqueuedAt && row.leaseExpired;
  return AdminNoticeSchema.parse({
    id: row.entry.id,
    title: row.entry.title,
    message: row.entry.message,
    actor: row.actor,
    recipient: row.recipient,
    status: dispatchFailed ? 'failed' : row.entry.status,
    attempts: dispatchFailed ? 5 : row.entry.attempts,
    revision: row.entry.revision,
    errorCode: dispatchFailed ? 'DELIVERY_FAILED' : row.entry.errorCode,
    createdAt: row.entry.createdAt.toISOString(),
    deliveredAt: row.entry.deliveredAt?.toISOString() ?? null,
  });
}
export async function readNotice(tx: Transaction, id: string) {
  const [row] = await tx
    .select(noticeFields)
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.recipientId))
    .innerJoin(noticeActor, eq(noticeActor.id, notifications.actorId))
    .innerJoin(outboxEvents, eq(outboxEvents.id, notifications.eventId))
    .where(and(eq(notifications.id, id), eq(notifications.kind, 'admin_notice')))
    .limit(1);
  if (!row) throw new BusinessError('NOT_FOUND', '管理员通知不存在或不可访问');
  return noticeView(row);
}
