import { authAuditEvents } from '@personamarket/database';
import { enqueueNotification } from '@personamarket/server';
import type { Transaction } from './locked-identity.js';

const messages: Readonly<Record<string, string>> = {
  'auth.password_changed': '你的登录密码已更新，所有旧会话已失效',
  'auth.password_reset_completed': '你的登录密码已重置，所有旧会话已失效',
  'auth.email_change_requested': '你的账号申请了邮箱变更，请核对是否为本人操作',
  'auth.email_changed': '你的账号邮箱已变更，所有旧会话已失效',
  'auth.mfa_enrolled': '你的账号已启用二次验证，请妥善保管恢复码',
  'auth.mfa_recovery_used': '你的账号使用了一枚恢复码，请核对是否为本人操作',
  'auth.deactivation_requested': '你的停用申请已提交，可以在处理前撤回',
  'auth.deactivation_withdrawn': '你的停用申请已撤回',
};
/** 安全审计与必要的站内提示原子保存，消息不含凭据或安全链接 */
export async function recordSecurityEvent(
  tx: Transaction,
  userId: string,
  requestId: string,
  event: string,
) {
  const [record] = await tx
    .insert(authAuditEvents)
    .values({ userId, requestId, event })
    .returning({ id: authAuditEvents.id });
  if (!record) throw new Error('SECURITY_AUDIT_INSERT_FAILED');
  const message = messages[event];
  if (message)
    await enqueueNotification(tx, {
      recipientId: userId,
      actorId: null,
      sourceId: record.id,
      kind: 'account_security',
      title: '账号安全提示',
      message,
      target: { type: 'account' },
    });
  return record.id;
}
