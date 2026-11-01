import {
  NotificationDeliveryJobSchema,
  type NotificationDeliveryDetail,
} from '@personamarket/contracts';

export type NotificationEventFacts = {
  id: string;
  topic: string;
  payload: unknown;
  attempts: number;
  deliveredAt: Date | null;
  leaseExpired: boolean;
};
export type NotificationRetryFacts = {
  id: string;
  eventId: string;
  status: NotificationDeliveryDetail['status'];
  recipientStatus: string;
  currentEventProcessed: boolean;
  event: NotificationEventFacts | null;
};

export function notificationEventMatches(
  notification: Pick<NotificationRetryFacts, 'id' | 'eventId'>,
  event: NotificationEventFacts | null,
) {
  if (!event || event.id !== notification.eventId || event.topic !== 'notification.deliver')
    return false;
  const parsed = NotificationDeliveryJobSchema.omit({ eventId: true }).safeParse(event.payload);
  return parsed.success && parsed.data.notificationId === notification.id;
}

/** GET只说明资格；POST在最终业务事务中以同一规则重新核对。 */
export function notificationRetryPolicy(facts: NotificationRetryFacts): {
  retryAllowed: boolean;
  retryBlockedReason: NotificationDeliveryDetail['retryBlockedReason'];
} {
  const denied = (reason: NonNullable<NotificationDeliveryDetail['retryBlockedReason']>) => ({
    retryAllowed: false,
    retryBlockedReason: reason,
  });
  if (!notificationEventMatches(facts, facts.event)) return denied('STATE_UNVERIFIABLE');
  // 消费最终失败可能先于派发确认；活跃派发收尾期间不新增人工轮次
  if (facts.status === 'failed' && facts.event && !facts.event.leaseExpired)
    return denied('STATE_UNVERIFIABLE');
  const terminal = facts.status === 'delivered' || facts.status === 'skipped';
  // 该consumer只确认当前事件；完成与业务状态必须来自同一轮次
  if (terminal !== facts.currentEventProcessed) return denied('STATE_UNVERIFIABLE');
  const dispatchFailed =
    facts.status === 'queued' &&
    facts.event !== null &&
    facts.event.attempts >= 5 &&
    facts.event.deliveredAt === null &&
    facts.event.leaseExpired;
  if (facts.status !== 'failed' && !dispatchFailed) return denied('NOT_FAILED');
  if (facts.recipientStatus !== 'active') return denied('RECIPIENT_UNAVAILABLE');
  return { retryAllowed: true, retryBlockedReason: null };
}
