import type { Database } from '@personamarket/database';
import { mailRecipientHash } from './mail-outbox.js';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

/** 不解密邮件、不返回地址/令牌。无上下文的升级前邮件明确是legacy_unknown。 */
export async function readMailContext(
  database: Database,
  eventId: string,
  recipient?: string,
  tx?: Transaction,
) {
  type ContextRow = {
    purpose:
      'email_verify' | 'password_reset' | 'email_change' | 'security_notice' | 'review_notice';
    user_id: string | null;
    token_id: string | null;
    source_id: string | null;
    source_type: 'account' | 'persona' | 'profile_submission' | 'auth_audit';
    audit_user_id: string | null;
    audit_event: string | null;
    recipient_hash: string;
    user_status: string | null;
    email: string | null;
    email_verified_at: Date | string | null;
    token_purpose: string | null;
    token_user_id: string | null;
    target_email: string | null;
    consumed_at: Date | string | null;
    expires_at: Date | string | null;
    expired: boolean | null;
  };
  const query = sql`SELECT c.*,u.status AS user_status,u.email,u.email_verified_at,t.purpose AS token_purpose,t.user_id AS token_user_id,t.target_email,t.consumed_at,t.expires_at,t.expires_at<=clock_timestamp() AS expired,a.user_id AS audit_user_id,a.event AS audit_event
    FROM mail_task_contexts c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN auth_tokens t ON t.id=c.token_id LEFT JOIN auth_audit_events a ON c.source_type='auth_audit' AND a.id=c.source_id WHERE c.event_id=${eventId}::uuid`;
  const row = (
    tx ? await tx.execute<ContextRow>(query) : await database.db.execute<ContextRow>(query)
  ).rows[0];
  if (!row) return null;
  // Drizzle的原始execute保留PostgreSQL时间字符串，不能假定pool.query的Date映射。
  const expiresAt = row.expires_at === null ? null : z.coerce.date().parse(row.expires_at);
  let state:
    | 'valid'
    | 'account_unavailable'
    | 'recipient_changed'
    | 'token_missing'
    | 'token_expired'
    | 'token_consumed'
    | 'token_mismatch' = 'valid';
  if (!row.user_id || row.user_status !== 'active') state = 'account_unavailable';
  else if (recipient && mailRecipientHash(recipient) !== row.recipient_hash)
    state = 'recipient_changed';
  else if (['email_verify', 'password_reset', 'email_change'].includes(row.purpose)) {
    if (!row.token_id || !row.expires_at) state = 'token_missing';
    else if (row.token_user_id !== row.user_id || row.token_purpose !== row.purpose)
      state = 'token_mismatch';
    else if (row.consumed_at) state = 'token_consumed';
    else if (row.expired) state = 'token_expired';
    else if (
      mailRecipientHash(
        row.purpose === 'email_change' ? (row.target_email ?? '') : (row.email ?? ''),
      ) !== row.recipient_hash
    )
      state = 'recipient_changed';
    else if (row.purpose === 'email_verify' && row.email_verified_at) state = 'token_consumed';
  } else if (row.purpose === 'security_notice' && row.source_type === 'auth_audit') {
    // 明确安全事件使用事务内已验证地址快照；邮箱变更成功后仍应告知旧邮箱。
    // 只有实际同账号审计事件允许此语义，不给无来源的历史/自造邮件放宽地址检查。
    if (
      row.audit_user_id !== row.user_id ||
      ![
        'auth.password_changed',
        'auth.email_change_requested',
        'auth.email_changed',
        'auth.deactivation_requested',
      ].includes(row.audit_event ?? '')
    )
      state = 'token_mismatch';
  } else if (!row.email_verified_at || mailRecipientHash(row.email ?? '') !== row.recipient_hash)
    state = 'recipient_changed';
  return {
    purpose: row.purpose,
    userId: row.user_id,
    tokenLinked: row.token_id !== null,
    sourceId: row.source_id,
    sourceType: row.source_type,
    state,
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}
