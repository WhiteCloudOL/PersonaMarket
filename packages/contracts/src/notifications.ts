import { z } from 'zod';
import { IdSchema, TimestampSchema, textSchema } from './common.js';
import { UsernameSchema } from './auth.js';

export const NotificationKindSchema = z.enum([
  'release_approved',
  'release_rejected',
  'comment_approved',
  'comment_rejected',
  'comment_state',
  'comment_reply',
  'persona_state',
  'profile_approved',
  'profile_rejected',
  'profile_state',
  'report_updated',
  'account_security',
  'admin_notice',
]);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;
export const NotificationDeliveryStateSchema = z.enum(['queued', 'delivered', 'skipped', 'failed']);
export const NotificationTargetSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('own_persona'), personaId: IdSchema }),
  z.strictObject({ type: z.literal('own_comment'), personaId: IdSchema, commentId: IdSchema }),
  z.strictObject({ type: z.literal('public_comment'), personaId: IdSchema, commentId: IdSchema }),
  z.strictObject({ type: z.literal('own_report'), reportId: IdSchema }),
  z.strictObject({ type: z.literal('own_profile') }),
  z.strictObject({ type: z.literal('account') }),
  z.strictObject({ type: z.literal('none') }),
]);
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;
export const NotificationTitleSchema = textSchema(2, 120).refine(
  (value) => !/\p{Cc}/u.test(value),
  '通知标题不能包含换行或控制字符',
);
export const NotificationMessageSchema = textSchema(1, 2000).refine(
  (value) =>
    Array.from(value).every(
      (character) => !/\p{Cc}/u.test(character) || ['\t', '\r', '\n'].includes(character),
    ),
  '通知正文不能包含不可见控制字符',
);
const targets = {
  release_approved: 'own_persona',
  release_rejected: 'own_persona',
  persona_state: 'own_persona',
  comment_approved: 'own_comment',
  comment_rejected: 'own_comment',
  comment_state: 'own_comment',
  comment_reply: 'public_comment',
  report_updated: 'own_report',
  profile_approved: 'own_profile',
  profile_rejected: 'own_profile',
  profile_state: 'own_profile',
  account_security: 'account',
  admin_notice: 'none',
} as const;
// 仅服务端业务事务使用，不提供普通用户任意创建通知的入口
export const NotificationPayloadSchema = z
  .strictObject({
    recipientId: IdSchema,
    actorId: IdSchema.nullable(),
    sourceId: IdSchema,
    kind: NotificationKindSchema,
    title: NotificationTitleSchema,
    message: NotificationMessageSchema,
    target: NotificationTargetSchema,
  })
  .superRefine((value, context) => {
    if (targets[value.kind] !== value.target.type)
      context.addIssue({ code: 'custom', path: ['target'], message: '通知类型和目标不匹配' });
    if (value.kind === 'admin_notice' && !value.actorId)
      context.addIssue({ code: 'custom', path: ['actorId'], message: '管理员通知必须保留发送者' });
  });
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;
export const NotificationDeliveryJobSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: IdSchema,
  notificationId: IdSchema,
});
export const NotificationIdSchema = z.strictObject({ id: IdSchema });
const pagination = {
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(20).max(20).default(20),
};
export const NotificationsQuerySchema = z.strictObject({
  ...pagination,
  status: z.enum(['all', 'unread']).default('all'),
});
export type NotificationsQuery = z.infer<typeof NotificationsQuerySchema>;
export const InboxNotificationSchema = z
  .strictObject({
    id: IdSchema,
    kind: NotificationKindSchema,
    title: NotificationTitleSchema,
    message: NotificationMessageSchema,
    createdAt: TimestampSchema,
    readAt: TimestampSchema.nullable(),
    available: z.boolean(),
    path: z
      .string()
      .regex(/^\/(?:dashboard\/|personas\/|account(?:$|[?#]))/)
      .nullable(),
  })
  .refine((value) => value.available || value.path === null, '不可访问的通知目标不能提供跳转地址');
export type InboxNotification = z.infer<typeof InboxNotificationSchema>;
const counts = { unreadCount: z.number().int().nonnegative(), throughId: IdSchema.nullable() };
const meta = {
  page: z.number().int().positive(),
  pageSize: z.literal(20),
  total: z.number().int().nonnegative(),
};
export const NotificationsResponseSchema = z.strictObject({
  data: z.array(InboxNotificationSchema).max(20),
  meta: z.strictObject({ ...meta, ...counts }),
});
export const NotificationCountResponseSchema = z.strictObject({ data: z.strictObject(counts) });
export const ReadNotificationSchema = z.strictObject({});
export const ReadAllNotificationsSchema = z.strictObject({ throughId: IdSchema });
export const NotificationReadResponseSchema = z.strictObject({
  data: z.strictObject({ updated: z.number().int().nonnegative() }),
});

export const NotificationRecipientQuerySchema = z.strictObject({ username: UsernameSchema });
export const NotificationRecipientResponseSchema = z.strictObject({
  data: z.strictObject({ id: IdSchema, username: UsernameSchema }),
});
export const CreateAdminNoticeSchema = z.strictObject({
  recipientId: IdSchema,
  title: NotificationTitleSchema,
  message: NotificationMessageSchema,
  confirmed: z.literal(true),
});
export type CreateAdminNotice = z.infer<typeof CreateAdminNoticeSchema>;
export const RetryAdminNoticeSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  confirmed: z.literal(true),
});
export const AdminNoticesQuerySchema = z.strictObject({
  ...pagination,
  status: z.enum(['all', ...NotificationDeliveryStateSchema.options]).default('all'),
  recipientId: IdSchema.optional(),
});
export type AdminNoticesQuery = z.infer<typeof AdminNoticesQuerySchema>;
export const AdminNoticeSchema = z.strictObject({
  id: IdSchema,
  recipient: z.strictObject({ id: IdSchema, username: UsernameSchema }),
  actor: z.strictObject({ id: IdSchema, username: UsernameSchema }),
  title: NotificationTitleSchema,
  message: NotificationMessageSchema,
  createdAt: TimestampSchema,
  deliveredAt: TimestampSchema.nullable(),
  status: NotificationDeliveryStateSchema,
  attempts: z.number().int().min(0).max(5),
  revision: z.number().int().positive(),
  errorCode: z.enum(['DELIVERY_FAILED', 'TARGET_UNAVAILABLE']).nullable(),
});
export type AdminNotice = z.infer<typeof AdminNoticeSchema>;
export const AdminNoticeResponseSchema = z.strictObject({ data: AdminNoticeSchema });
export const AdminNoticesResponseSchema = z.strictObject({
  data: z.array(AdminNoticeSchema).max(20),
  meta: z.strictObject(meta),
});
export const NotificationFailuresQuerySchema = z.strictObject(pagination);
export type NotificationFailuresQuery = z.infer<typeof NotificationFailuresQuerySchema>;
export const NotificationFailureSchema = z.strictObject({
  id: IdSchema,
  recipient: z.strictObject({ id: IdSchema, username: UsernameSchema }),
  kind: NotificationKindSchema,
  status: NotificationDeliveryStateSchema,
  attempts: z.number().int().min(0).max(5),
  revision: z.number().int().positive(),
  createdAt: TimestampSchema,
});
export type NotificationFailure = z.infer<typeof NotificationFailureSchema>;
export const NotificationFailureResponseSchema = z.strictObject({
  data: NotificationFailureSchema,
});
export const NotificationPreferencesSchema = z.strictObject({
  reviewEmail: z.boolean(),
  revision: z.number().int().nonnegative(),
});
export const NotificationPreferencesResponseSchema = z.strictObject({
  data: NotificationPreferencesSchema,
});
export const UpdateNotificationPreferencesSchema = z.strictObject({
  reviewEmail: z.boolean(),
  expectedRevision: z.number().int().nonnegative(),
});
export type UpdateNotificationPreferences = z.infer<typeof UpdateNotificationPreferencesSchema>;
export const NotificationFailuresResponseSchema = z.strictObject({
  data: z.array(NotificationFailureSchema).max(20),
  meta: z.strictObject(meta),
});

// 精确运维详情不复制通知正文、业务目标或邮件等私有资料
export const NotificationDeliveryDetailSchema = z
  .strictObject({
    id: IdSchema,
    recipient: z.strictObject({ id: IdSchema, username: UsernameSchema }),
    kind: NotificationKindSchema,
    scope: z.enum(['notice', 'business']),
    revision: z.number().int().positive(),
    eventId: IdSchema,
    status: NotificationDeliveryStateSchema,
    createdAt: TimestampSchema,
    dispatchAttempts: z.number().int().nonnegative().nullable(),
    executionAttempts: z.number().int().min(0).max(5).nullable(),
    lastAttemptedAt: TimestampSchema.nullable(),
    completedAt: TimestampSchema.nullable(),
    deliveredAt: TimestampSchema.nullable(),
    errorCode: z.enum(['DELIVERY_FAILED', 'TARGET_UNAVAILABLE']).nullable(),
    currentEventProcessed: z.boolean(),
    retryAllowed: z.boolean(),
    retryBlockedReason: z
      .enum(['NOT_FAILED', 'RECIPIENT_UNAVAILABLE', 'STATE_UNVERIFIABLE'])
      .nullable(),
    requiresRecentVerification: z.boolean(),
  })
  .refine(
    (value) => value.scope === (value.kind === 'admin_notice' ? 'notice' : 'business'),
    '通知处理范围必须符合实际类型',
  )
  .refine(
    (value) => value.retryAllowed === (value.retryBlockedReason === null),
    '通知处理资格必须与拒绝原因一致',
  );
export type NotificationDeliveryDetail = z.infer<typeof NotificationDeliveryDetailSchema>;
export const NotificationDeliveryDetailResponseSchema = z.strictObject({
  data: NotificationDeliveryDetailSchema,
  meta: z.strictObject({ observedAt: TimestampSchema }),
});
export const NotificationRetryReceiptQuerySchema = z.strictObject({
  expectedRevision: z.coerce.number().int().positive(),
});
export type NotificationRetryReceiptQuery = z.infer<typeof NotificationRetryReceiptQuerySchema>;
export const NotificationRetryReceiptResponseSchema = z.strictObject({
  data: z
    .strictObject({
      notificationId: IdSchema,
      recorded: z.boolean(),
      recordedAt: TimestampSchema.nullable(),
    })
    .refine(
      (value) => value.recorded === (value.recordedAt !== null),
      '原请求记录状态必须与记录时间一致',
    ),
  meta: z.strictObject({ observedAt: TimestampSchema }),
});
