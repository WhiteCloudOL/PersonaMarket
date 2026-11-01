import type { NotificationDeliveryDetail } from '@personamarket/contracts';

export type DeliveryCommand = {
  accountId: string;
  id: string;
  scope: 'notice' | 'business';
  input: { expectedRevision: number; confirmed: true };
  key: string;
  uncertain: boolean;
  accepted: boolean;
};
export type DeliveryReceipt = { recorded: boolean; recordedAt: string | null };
export type DeliveryDraft = {
  command: DeliveryCommand;
  receipt?: DeliveryReceipt | undefined;
  message?: string | undefined;
};

export const notificationAttemptText = (value: number | null) =>
  value === null ? '未记录' : value + ' 次';

const deliveryTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
export const notificationTimestamp = (value: string) =>
  deliveryTime.format(new Date(value)) + ' · 北京时间';

const definitiveErrors = new Set([
  'MFA_REQUIRED',
  'REAUTH_REQUIRED',
  'INVALID_INPUT',
  'CONFLICT',
  'REVISION_CONFLICT',
  'NOT_FOUND',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'RATE_LIMITED',
  'MAINTENANCE_MODE',
]);
export function deliveryResultUncertain(code: string | undefined, alreadyUncertain: boolean) {
  return alreadyUncertain || !code || !definitiveErrors.has(code);
}

/** 旧修订已过去时，迟到原命令不能再创建旧轮次；仍须先显式核对回执。 */
export function canBeginDeliveryRound(
  current: NotificationDeliveryDetail,
  draft: DeliveryDraft | undefined,
) {
  if (!current.retryAllowed) return false;
  if (!draft) return true;
  if (draft.command.id !== current.id || draft.command.scope !== current.scope) return false;
  return (
    current.revision > draft.command.input.expectedRevision &&
    (draft.command.accepted || draft.receipt !== undefined)
  );
}

export function deliveryStateText(current: NotificationDeliveryDetail) {
  if (current.retryBlockedReason === 'STATE_UNVERIFIABLE')
    return {
      title: '当前结果无法核验',
      description: '暂时无法确认这条通知的处理结果，请保留原请求并重新核对',
    };
  if (current.status === 'delivered')
    return {
      title: '已送达站内通知',
      description: '通知已进入收件人的站内通知列表',
    };
  if (current.status === 'skipped')
    return {
      title: '已跳过投递',
      description: '本轮已结束，目标或接收资格不可用，没有向用户送达这条通知',
    };
  if (current.retryBlockedReason === 'RECIPIENT_UNAVAILABLE')
    return {
      title: '接收账号暂不可接收',
      description: '当前不能创建新的投递轮次，请先核对账号状态',
    };
  if (current.status === 'queued' && current.retryAllowed)
    return {
      title: '仍在排队，派发重试已耗尽',
      description: '业务尚未送达；派发与消费执行次数分别记录，可确认重新投递',
    };
  if (current.status === 'failed')
    return {
      title: '本轮投递失败',
      description: '原通知内容保持不变，重新投递前仍会核对接收资格和当前业务状态',
    };
  return {
    title: '正在排队或处理中',
    description: '当前轮次尚未结束，请核对后续状态，不要重复创建新轮次',
  };
}

export function notificationHref(
  pathname: string,
  search: string,
  patch: Record<string, string | undefined>,
) {
  const next = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch))
    if (value === undefined) next.delete(key);
    else next.set(key, value);
  return pathname + (next.size ? '?' + next : '');
}

export const notificationKinds = {
  release_approved: '作品审核通过',
  release_rejected: '作品审核退回',
  comment_approved: '评论审核通过',
  comment_rejected: '评论审核退回',
  comment_state: '评论状态',
  comment_reply: '公开回复',
  persona_state: '作品状态',
  report_updated: '举报处理',
  account_security: '账号安全',
  admin_notice: '管理员通知',
  profile_approved: '资料审核通过',
  profile_rejected: '资料审核退回',
  profile_state: '资料公开状态',
};
