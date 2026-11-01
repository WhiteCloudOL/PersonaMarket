import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ne } from 'drizzle-orm';
import { notifications, users, type Database } from '@personamarket/database';
import {
  NotificationFailureSchema,
  NotificationFailureResponseSchema,
  NotificationFailuresResponseSchema,
  type NotificationFailuresQuery,
  type RetryAdminNoticeSchema,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { z } from 'zod';
import type { Identity } from '../auth/auth.service.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { DATABASE } from '../tokens.js';
import { retryNotification } from './notification-retry.js';

// 失败任务运维只读取此白名单，不读取正文、目标、业务事件或私有证据
const fields = {
  id: notifications.id,
  recipient: { id: users.id, username: users.username },
  kind: notifications.kind,
  status: notifications.status,
  attempts: notifications.attempts,
  revision: notifications.revision,
  createdAt: notifications.createdAt,
};
function view(
  row: { createdAt: Date } & Omit<z.input<typeof NotificationFailureSchema>, 'createdAt'>,
) {
  return NotificationFailureSchema.parse({ ...row, createdAt: row.createdAt.toISOString() });
}
@Injectable()
export class NotificationFailuresRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private transaction<T>(
    actor: Identity,
    write: boolean,
    operation: (tx: Transaction) => Promise<T>,
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        return operation(tx);
      },
      { area: 'content', serializeWrites: write },
    );
  }
  list(actor: Identity, input: NotificationFailuresQuery) {
    return this.transaction(actor, false, async (tx) => {
      const condition = and(
        eq(notifications.status, 'failed'),
        ne(notifications.kind, 'admin_notice'),
      );
      const rows = await tx
        .select(fields)
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.recipientId))
        .where(condition)
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(20)
        .offset((input.page - 1) * 20);
      const [total] = await tx.select({ amount: count() }).from(notifications).where(condition);
      return NotificationFailuresResponseSchema.parse({
        data: rows.map(view),
        meta: { page: input.page, pageSize: 20, total: total?.amount ?? 0 },
      });
    });
  }
  retry(
    actor: Identity,
    id: string,
    input: z.infer<typeof RetryAdminNoticeSchema>,
    key: string,
    requestId: string,
  ) {
    return this.transaction(actor, true, async (tx) => {
      const result = await retryNotification(tx, actor, id, input, key, requestId, 'business');
      const [row] = await tx
        .select(fields)
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.recipientId))
        .where(and(eq(notifications.id, result), ne(notifications.kind, 'admin_notice')))
        .limit(1);
      if (!row) throw new BusinessError('NOT_FOUND', '通知任务不存在或不可访问');
      return NotificationFailureResponseSchema.parse({ data: view(row) });
    });
  }
}
