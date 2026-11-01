import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  authAuditEvents,
  authSessions,
  userManagementRecords,
  users,
} from '@personamarket/database';
import type {
  RevokeAdminUserSessionsSchema,
  SetAdminUserRoleSchema,
  SetAdminUserStatusSchema,
} from '@personamarket/contracts';
import { BusinessError, enqueueNotification } from '@personamarket/server';
import type { z } from 'zod';
import type { Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
export type UserManagementCommand =
  | { action: 'set_role'; input: z.infer<typeof SetAdminUserRoleSchema> }
  | { action: 'set_status'; input: z.infer<typeof SetAdminUserStatusSchema> }
  | { action: 'revoke_sessions'; input: z.infer<typeof RevokeAdminUserSessionsSchema> };

async function blockOwnedPersonas(
  tx: Transaction,
  actor: Identity,
  targetId: string,
  reason: string,
  requestId: string,
) {
  // 先按固定顺序锁定，再在同一SQL内下架并追加逐作品记录，避免大批量参数和逐行网络往返。
  const rows = await tx.execute<{ value: number }>(sql`
    WITH candidates AS MATERIALIZED (
      SELECT id FROM personas WHERE owner_id=${targetId} AND moderation_state='normal'
      ORDER BY id FOR UPDATE
    ), affected AS (
      UPDATE personas p SET moderation_state='blocked',revision=p.revision+1,updated_at=clock_timestamp()
      FROM candidates c WHERE p.id=c.id RETURNING p.id
    ), recorded AS (
      INSERT INTO moderation_records(persona_id,actor_id,action,reason,request_id,self_review)
      SELECT id,${actor.account.id},'account_ban_persona_blocked',${reason},${requestId},${actor.account.id === targetId}
      FROM affected RETURNING id
    ) SELECT count(*)::int AS value FROM recorded
  `);
  return rows.rows[0]?.value ?? 0;
}

/** 调用方先持有统一管理锁并完成身份与近期验证；与举报处置共享同一事务 */
export async function applyUserAdministration(
  tx: Transaction,
  actor: Identity,
  id: string,
  command: UserManagementCommand,
  requestId: string,
) {
  const [target] = await tx
    .select({
      id: users.id,
      role: users.role,
      status: users.status,
      securityVersion: users.securityVersion,
    })
    .from(users)
    .where(eq(users.id, id))
    .for('no key update');
  if (!target) throw new BusinessError('NOT_FOUND', '用户不存在或不可访问');
  if (target.securityVersion !== command.input.expectedSecurityVersion)
    throw new BusinessError(
      'REVISION_CONFLICT',
      '用户状态已变化，输入已保留，请读取最新状态后核对',
    );

  let action: typeof userManagementRecords.$inferInsert.action;
  let scope: typeof userManagementRecords.$inferInsert.scope = 'account_only';
  let affectedPersonas = 0;
  let changed:
    { role: typeof target.role; status: typeof target.status; securityVersion: number } | undefined;
  if (command.action === 'set_role') {
    if (command.input.role === target.role)
      throw new BusinessError('CONFLICT', '用户已是所选角色，请核对当前状态');
    action = 'set_role';
    [changed] = await tx
      .update(users)
      .set({ role: command.input.role })
      .where(eq(users.id, id))
      .returning({
        role: users.role,
        status: users.status,
        securityVersion: users.securityVersion,
      });
  } else if (command.action === 'set_status') {
    const desired = command.input.status;
    if (target.status === 'deactivated')
      throw new BusinessError('CONFLICT', '已停用账号需按停用申请流程处理');
    if (target.status === desired)
      throw new BusinessError('CONFLICT', '账号已处于所选状态，请核对当前状态');
    action = desired === 'banned' ? 'ban' : 'restore';
    scope = command.input.scope;
    [changed] = await tx.update(users).set({ status: desired }).where(eq(users.id, id)).returning({
      role: users.role,
      status: users.status,
      securityVersion: users.securityVersion,
    });
    if (scope === 'account_and_personas')
      affectedPersonas = await blockOwnedPersonas(tx, actor, id, command.input.reason, requestId);
  } else {
    action = 'revoke_sessions';
    [changed] = await tx
      .update(users)
      .set({ securityVersion: sql`${users.securityVersion}+1` })
      .where(eq(users.id, id))
      .returning({
        role: users.role,
        status: users.status,
        securityVersion: users.securityVersion,
      });
  }
  if (!changed) throw new BusinessError('CONFLICT', '用户状态已变化，请读取最新状态后核对');
  const revoked = await tx
    .update(authSessions)
    .set({ revokedAt: sql`clock_timestamp()` })
    .where(and(eq(authSessions.userId, id), isNull(authSessions.revokedAt)))
    .returning({ id: authSessions.id });
  const [record] = await tx
    .insert(userManagementRecords)
    .values({
      actorId: actor.account.id,
      targetId: id,
      action,
      reason: command.input.reason,
      fromRole: target.role,
      toRole: changed.role,
      fromStatus: target.status,
      toStatus: changed.status,
      fromSecurityVersion: target.securityVersion,
      toSecurityVersion: changed.securityVersion,
      scope,
      affectedPersonas,
      revokedSessions: revoked.length,
      requestId,
    })
    .returning({ id: userManagementRecords.id });
  if (!record) throw new BusinessError('CONFLICT', '管理记录未保存，请重新核对操作');
  await tx.insert(authAuditEvents).values({ userId: id, event: 'admin.user.' + action, requestId });

  await enqueueNotification(tx, {
    recipientId: id,
    actorId: actor.account.id,
    sourceId: record.id,
    kind: 'account_security',
    title: '账号安全状态已更新',
    message: '管理员已调整你的账号安全状态，请重新登录后核对',
    target: { type: 'account' },
  });
  return {
    recordId: record.id,
    before: target,
    after: changed,
    revokedSessions: revoked.length,
    affectedPersonas,
  };
}
