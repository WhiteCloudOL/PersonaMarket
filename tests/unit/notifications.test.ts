import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  NotificationPayloadSchema,
  NotificationDeliveryJobSchema,
  CreateAdminNoticeSchema,
  ReadAllNotificationsSchema,
  NotificationsQuerySchema,
  InboxNotificationSchema,
} from '@personamarket/contracts';

it('通知目标受类型约束，任务只携带标识，不接受正文或私有凭据', () => {
  const payload = {
    recipientId: randomUUID(),
    actorId: null,
    sourceId: randomUUID(),
    kind: 'comment_reply',
    title: '你收到一条公开回复',
    message: '打开评论查看回复',
    target: { type: 'public_comment', personaId: randomUUID(), commentId: randomUUID() },
  };
  expect(NotificationPayloadSchema.safeParse(payload).success).toBe(true);
  expect(
    NotificationPayloadSchema.safeParse({
      ...payload,
      target: { type: 'own_report', reportId: randomUUID() },
    }).success,
  ).toBe(false);
  expect(
    NotificationPayloadSchema.safeParse({ ...payload, pendingBody: '未审核的私有正文' }).success,
  ).toBe(false);
  const job = { eventId: randomUUID(), notificationId: randomUUID(), schemaVersion: 1 };
  expect(NotificationDeliveryJobSchema.parse(job)).toEqual(job);
  expect(
    NotificationDeliveryJobSchema.safeParse({ ...job, body: '禁止将消息正文复制进队列' }).success,
  ).toBe(false);
});
it('管理员通知需要实际收件人和明确确认，文本保持原样并按Unicode限制', () => {
  const input = {
    recipientId: randomUUID(),
    title: '给创作者的提醒',
    message: ' \n保留完整文字🌟\n ',
    confirmed: true,
  };
  expect(CreateAdminNoticeSchema.parse(input)).toEqual(input);
  expect(CreateAdminNoticeSchema.safeParse({ ...input, actorId: randomUUID() }).success).toBe(
    false,
  );
  expect(CreateAdminNoticeSchema.safeParse({ ...input, confirmed: false }).success).toBe(false);
  expect(CreateAdminNoticeSchema.safeParse({ ...input, message: '🌟'.repeat(2000) }).success).toBe(
    true,
  );
  expect(CreateAdminNoticeSchema.safeParse({ ...input, message: '🌟'.repeat(2001) }).success).toBe(
    false,
  );
  expect(CreateAdminNoticeSchema.safeParse({ ...input, title: '标题\n不能换行' }).success).toBe(
    false,
  );
});
it('全部已读按当前可见的通知标识确定边界，分页和跳转不能越界', () => {
  expect(ReadAllNotificationsSchema.safeParse({ throughId: randomUUID() }).success).toBe(true);
  expect(ReadAllNotificationsSchema.safeParse({ recipientId: randomUUID() }).success).toBe(false);
  expect(NotificationsQuerySchema.parse({})).toEqual({ status: 'all', page: 1, pageSize: 20 });
  expect(NotificationsQuerySchema.safeParse({ page: 501 }).success).toBe(false);
  const item = {
    id: randomUUID(),
    kind: 'comment_reply',
    title: '你收到一条回复',
    message: '打开评论查看回复',
    createdAt: new Date().toISOString(),
    readAt: null,
    available: false,
    path: null,
  };
  expect(InboxNotificationSchema.safeParse(item).success).toBe(true);
  expect(InboxNotificationSchema.safeParse({ ...item, path: '//example.invalid' }).success).toBe(
    false,
  );
  expect(
    InboxNotificationSchema.safeParse({ ...item, path: '/personas/' + randomUUID() }).success,
  ).toBe(false);
});
