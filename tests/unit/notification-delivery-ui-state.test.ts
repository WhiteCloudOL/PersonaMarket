import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { NotificationDeliveryDetail } from '@personamarket/contracts';
import {
  canBeginDeliveryRound,
  deliveryResultUncertain,
  deliveryStateText,
  notificationAttemptText,
  notificationHref,
  notificationTimestamp,
  type DeliveryDraft,
} from '../../apps/web/src/components/notifications/delivery-state.js';

function current(): NotificationDeliveryDetail {
  return {
    id: randomUUID(),
    recipient: { id: randomUUID(), username: 'owned_receiver' },
    kind: 'admin_notice',
    scope: 'notice',
    revision: 2,
    eventId: randomUUID(),
    status: 'failed',
    createdAt: new Date().toISOString(),
    dispatchAttempts: 5,
    executionAttempts: null,
    lastAttemptedAt: null,
    completedAt: new Date().toISOString(),
    deliveredAt: null,
    errorCode: 'DELIVERY_FAILED',
    currentEventProcessed: false,
    retryAllowed: true,
    retryBlockedReason: null,
    requiresRecentVerification: false,
  };
}
function draft(value: NotificationDeliveryDetail): DeliveryDraft {
  return {
    command: {
      accountId: randomUUID(),
      id: value.id,
      scope: value.scope,
      input: { expectedRevision: 1, confirmed: true },
      key: randomUUID(),
      uncertain: true,
      accepted: false,
    },
  };
}

it('通知定位的开关只改变自己的URL参数，失败列表与无关筛选可恢复', () => {
  const id = randomUUID(),
    previous = 'page=3&status=failed&recipientId=owned&failuresPage=2&custom=keep';
  const opened = notificationHref('/admin/notifications', previous, { deliveryId: id });
  const query = new URL('https://fixture.invalid' + opened).searchParams;
  expect(query.get('deliveryId')).toBe(id);
  expect(query.get('failuresPage')).toBe('2');
  expect(query.get('page')).toBe('3');
  expect(query.get('custom')).toBe('keep');
  expect(
    notificationHref('/admin/notifications', query.toString(), { deliveryId: undefined }),
  ).toBe('/admin/notifications?' + previous);
});

it('旧未知请求遇到限流或近期验证仍未知，不因此换key或宣称未受理', () => {
  for (const code of ['RATE_LIMITED', 'MFA_REQUIRED', 'REAUTH_REQUIRED', 'REVISION_CONFLICT']) {
    expect(deliveryResultUncertain(code, true)).toBe(true);
    expect(deliveryResultUncertain(code, false)).toBe(false);
  }
  expect(deliveryResultUncertain(undefined, false)).toBe(true);
  expect(deliveryResultUncertain('SERVICE_UNAVAILABLE', false)).toBe(true);
});

it('新轮次必须有可重投的最新修订与已核对的原请求，不能用unknown盲目换标识', () => {
  const value = current(),
    saved = draft(value),
    frozen = structuredClone(saved);
  expect(canBeginDeliveryRound(value, undefined)).toBe(true);
  expect(canBeginDeliveryRound(value, saved)).toBe(false);
  expect(
    canBeginDeliveryRound(value, {
      ...saved,
      command: { ...saved.command, id: randomUUID(), accepted: true },
    }),
  ).toBe(false);
  expect(
    canBeginDeliveryRound(value, { ...saved, receipt: { recorded: false, recordedAt: null } }),
  ).toBe(true);
  expect(canBeginDeliveryRound(value, { command: { ...saved.command, accepted: true } })).toBe(
    true,
  );
  expect(
    canBeginDeliveryRound(
      { ...value, revision: 1 },
      { ...saved, receipt: { recorded: true, recordedAt: value.createdAt } },
    ),
  ).toBe(false);
  expect(
    canBeginDeliveryRound(
      { ...value, retryAllowed: false, retryBlockedReason: 'NOT_FAILED' },
      { command: { ...saved.command, accepted: true } },
    ),
  ).toBe(false);
  expect(saved).toEqual(frozen);
});

it('当前回执不可核验优先于字面送达状态，skipped不冒充delivered', () => {
  const value = current();
  expect(
    deliveryStateText({
      ...value,
      status: 'delivered',
      retryAllowed: false,
      retryBlockedReason: 'STATE_UNVERIFIABLE',
    }).title,
  ).toBe('当前结果无法核验');
  expect(
    deliveryStateText({
      ...value,
      status: 'skipped',
      retryAllowed: false,
      retryBlockedReason: 'NOT_FAILED',
      currentEventProcessed: true,
    }).title,
  ).toBe('已跳过投递');
  expect(deliveryStateText({ ...value, status: 'queued' }).title).toBe('仍在排队，派发重试已耗尽');
  expect(
    deliveryStateText({
      ...value,
      status: 'queued',
      retryAllowed: false,
      retryBlockedReason: 'NOT_FAILED',
    }).title,
  ).toBe('正在排队或处理中');
});

it('未记录的尝试次数与真正零次分开表达，分发数不补成执行数', () => {
  expect(notificationAttemptText(null)).toBe('未记录');
  expect(notificationAttemptText(0)).toBe('0 次');
  expect(notificationAttemptText(5)).toBe('5 次');
});

it('投递观测与回执按北京时间保留时分秒，UTC跨日不会沿用浏览器本地时区', () => {
  expect(notificationTimestamp('2026-11-01T01:59:20.000Z')).toContain('09:59:20');
  const nextDay = notificationTimestamp('2026-11-01T17:05:06.000Z');
  expect(nextDay).toContain('2026/11/02');
  expect(nextDay).toContain('01:05:06');
  expect(nextDay).toContain('北京时间');
});
