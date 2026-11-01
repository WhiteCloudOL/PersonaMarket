import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  NotificationDeliveryDetailSchema,
  NotificationRetryReceiptQuerySchema,
  NotificationRetryReceiptResponseSchema,
} from '@personamarket/contracts';
import {
  notificationEventMatches,
  notificationRetryPolicy,
  type NotificationRetryFacts,
} from '../../apps/api/src/notifications/notification-retry-policy.js';

function facts(): NotificationRetryFacts {
  const id = randomUUID(),
    eventId = randomUUID();
  return {
    id,
    eventId,
    status: 'queued',
    recipientStatus: 'active',
    currentEventProcessed: false,
    event: {
      id: eventId,
      topic: 'notification.deliver',
      payload: { schemaVersion: 1, notificationId: id },
      attempts: 5,
      deliveredAt: null,
      leaseExpired: true,
    },
  };
}

it('重投只接受完整当前事件及派发耗尽且租约结束，普通等待不是失败', () => {
  const current = facts();
  expect(notificationRetryPolicy(current)).toEqual({
    retryAllowed: true,
    retryBlockedReason: null,
  });
  if (!current.event) throw new Error('缺少测试事件');
  for (const event of [
    { ...current.event, attempts: 4 },
    { ...current.event, leaseExpired: false },
    { ...current.event, deliveredAt: new Date() },
  ])
    expect(notificationRetryPolicy({ ...current, event })).toEqual({
      retryAllowed: false,
      retryBlockedReason: 'NOT_FAILED',
    });
  for (const event of [
    null,
    { ...current.event, id: randomUUID() },
    { ...current.event, topic: 'auth.email' },
    { ...current.event, payload: { schemaVersion: 2, notificationId: current.id } },
    { ...current.event, payload: { schemaVersion: 1, notificationId: randomUUID() } },
    {
      ...current.event,
      payload: { schemaVersion: 1, notificationId: current.id, message: '不能接受额外字段' },
    },
  ]) {
    expect(notificationEventMatches(current, event)).toBe(false);
    expect(notificationRetryPolicy({ ...current, event }).retryBlockedReason).toBe(
      'STATE_UNVERIFIABLE',
    );
  }
});

it('四种业务状态、当前消费回执和账号资格分别核对，不把旧失败当再次送达', () => {
  const current = facts();
  expect(notificationRetryPolicy({ ...current, status: 'failed' }).retryAllowed).toBe(true);
  if (!current.event) throw new Error('缺少测试事件');
  for (const deliveredAt of [null, new Date()])
    expect(
      notificationRetryPolicy({
        ...current,
        status: 'failed',
        event: { ...current.event, deliveredAt, leaseExpired: false },
      }),
    ).toEqual({ retryAllowed: false, retryBlockedReason: 'STATE_UNVERIFIABLE' });
  expect(
    notificationRetryPolicy({ ...current, status: 'failed', recipientStatus: 'disabled' }),
  ).toEqual({ retryAllowed: false, retryBlockedReason: 'RECIPIENT_UNAVAILABLE' });
  for (const status of ['delivered', 'skipped'] as const) {
    expect(notificationRetryPolicy({ ...current, status, currentEventProcessed: true })).toEqual({
      retryAllowed: false,
      retryBlockedReason: 'NOT_FAILED',
    });
    expect(notificationRetryPolicy({ ...current, status }).retryBlockedReason).toBe(
      'STATE_UNVERIFIABLE',
    );
  }
  expect(
    notificationRetryPolicy({ ...current, status: 'failed', currentEventProcessed: true })
      .retryBlockedReason,
  ).toBe('STATE_UNVERIFIABLE');
});

it('精确DTO保留四状态和未知次数，禁止通知正文/目标，作用域必须符合实际kind', () => {
  const current = facts(),
    now = new Date().toISOString(),
    detail = {
      id: current.id,
      recipient: { id: randomUUID(), username: 'fixture_reader' },
      kind: 'admin_notice',
      scope: 'notice',
      revision: 1,
      eventId: current.eventId,
      status: 'queued',
      createdAt: now,
      dispatchAttempts: null,
      executionAttempts: null,
      lastAttemptedAt: null,
      completedAt: null,
      deliveredAt: null,
      errorCode: null,
      currentEventProcessed: false,
      retryAllowed: false,
      retryBlockedReason: 'STATE_UNVERIFIABLE',
      requiresRecentVerification: false,
    };
  expect(NotificationDeliveryDetailSchema.parse(detail).executionAttempts).toBeNull();
  for (const status of ['queued', 'delivered', 'skipped', 'failed'])
    expect(NotificationDeliveryDetailSchema.safeParse({ ...detail, status }).success).toBe(true);
  for (const extra of [
    { message: '私有正文' },
    { title: '私有标题' },
    { target: { type: 'account' } },
    { sourceId: randomUUID() },
    { email: 'reader@fixture.invalid' },
  ])
    expect(NotificationDeliveryDetailSchema.safeParse({ ...detail, ...extra }).success).toBe(false);
  expect(NotificationDeliveryDetailSchema.safeParse({ ...detail, scope: 'business' }).success).toBe(
    false,
  );
  expect(
    NotificationDeliveryDetailSchema.safeParse({ ...detail, retryAllowed: true }).success,
  ).toBe(false);
});

it('原请求回执时间与状态一致且不提供不存在的历史event，修订查询严格拒绝额外字段', () => {
  const now = new Date().toISOString(),
    value = {
      data: { notificationId: randomUUID(), recorded: false, recordedAt: null },
      meta: { observedAt: now },
    };
  expect(NotificationRetryReceiptResponseSchema.parse(value)).toEqual(value);
  expect(
    NotificationRetryReceiptResponseSchema.safeParse({
      ...value,
      data: { ...value.data, recorded: true },
    }).success,
  ).toBe(false);
  expect(
    NotificationRetryReceiptResponseSchema.safeParse({
      ...value,
      data: { ...value.data, eventId: randomUUID() },
    }).success,
  ).toBe(false);
  expect(NotificationRetryReceiptQuerySchema.parse({ expectedRevision: '2' })).toEqual({
    expectedRevision: 2,
  });
  for (const query of [
    {},
    { expectedRevision: '0' },
    { expectedRevision: '1.5' },
    { expectedRevision: '1', confirmed: true },
  ])
    expect(NotificationRetryReceiptQuerySchema.safeParse(query).success).toBe(false);
});
