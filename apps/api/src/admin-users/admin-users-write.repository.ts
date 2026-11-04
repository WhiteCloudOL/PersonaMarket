import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  authAuditEvents,
  idempotencyKeys,
  userManagementRecords,
  users,
  type Database,
} from '@personamarket/database';
import type {
  RevokeAdminUserSessionsSchema,
  DeleteAdminUserSchema,
  SetAdminUserRoleSchema,
  SetAdminUserStatusSchema,
} from '@personamarket/contracts';
import { BusinessError, contentHash, hashPassword } from '@personamarket/server';
import type { z } from 'zod';
import { DATABASE } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { userManagementTransaction } from './admin-users-transaction.js';
import { adminUserView } from './admin-user-views.js';
import { idempotentResult, rememberResult, updateProjection } from '../releases/release-helpers.js';
import { removePersonas } from '../admin/delete-personas.js';
import {
  applyUserAdministration,
  type UserManagementCommand as Command,
} from './user-administration.js';

@Injectable()
export class AdminUsersWriteRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  async delete(
    actor: Identity,
    id: string,
    input: z.infer<typeof DeleteAdminUserSchema>,
    key: string,
    requestId: string,
  ) {
    if (id.toLowerCase() === actor.account.id)
      throw new BusinessError('FORBIDDEN', '管理员不能删除自己的账号');
    const passwordHash = await hashPassword(randomUUID());
    const alias = 'd' + randomUUID().replaceAll('-', '').slice(1);
    await userManagementTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true);
        const operation = 'admin.user.delete';
        const command = { id, ...input };
        if (await idempotentResult(tx, actor, operation, key, command)) return;
        const [target] = await tx.select().from(users).where(eq(users.id, id)).for('no key update');
        if (!target || target.deletedAt) throw new BusinessError('NOT_FOUND', '账号不存在或已删除');
        if (
          target.securityVersion !== input.expectedSecurityVersion ||
          target.username !== input.username
        )
          throw new BusinessError('REVISION_CONFLICT', '账号信息已变化，请重新核对用户名和状态');
        await tx
          .update(users)
          .set({
            deletedAt: sql`clock_timestamp()`,
            username: alias,
            email: alias + '@deleted.invalid',
            passwordHash,
            emailVerifiedAt: null,
            status: 'deactivated',
            role: 'user',
          })
          .where(eq(users.id, id));
        await tx.execute(sql`DELETE FROM auth_sessions WHERE user_id=${id}`);
        await tx.execute(sql`DELETE FROM auth_tokens WHERE user_id=${id}`);
        await tx.execute(sql`DELETE FROM mfa_recovery_codes WHERE user_id=${id}`);
        await tx.execute(sql`DELETE FROM user_mfa WHERE user_id=${id}`);
        await tx.execute(sql`UPDATE profile_submissions SET status='WITHDRAWN',revision=revision+1,
        withdrawn_at=clock_timestamp() WHERE user_id=${id} AND status='PENDING'`);
        const hideComments =
          input.mode === 'remove_content' || target.status !== 'active' || !target.emailVerifiedAt;
        await tx.execute(sql`
        WITH affected AS MATERIALIZED (
          SELECT id,pending_revision_id FROM comments WHERE author_id=${id}
          AND (pending_revision_id IS NOT NULL OR (${hideComments} AND visibility<>'deleted'))
          ORDER BY id FOR UPDATE
        ), withdrawn AS (
          UPDATE comment_revisions r SET status='SUPERSEDED',reason=NULL FROM affected a WHERE r.id=a.pending_revision_id
        )
        UPDATE comments c SET pending_revision_id=NULL,revision=c.revision+1,updated_at=clock_timestamp(),
          visibility=CASE WHEN ${hideComments} THEN 'deleted' ELSE c.visibility END
        FROM affected a WHERE c.id=a.id
      `);
        if (input.mode === 'remove_content') {
          await removePersonas(tx, actor, sql`owner_id=${id}`, requestId);
        } else {
          await tx.execute(sql`UPDATE release_submissions SET status='WITHDRAWN',revision=revision+1,
          reason='作者账号已删除' WHERE submitted_by=${id} AND status='PENDING'`);
          const current = await tx.execute<{
            id: string;
            release_id: string;
          }>(sql`SELECT id,published_release_id AS release_id
          FROM personas WHERE owner_id=${id} AND published_release_id IS NOT NULL ORDER BY id FOR UPDATE`);
          for (const row of current.rows) await updateProjection(tx, row.id, row.release_id);
        }
        await tx.insert(authAuditEvents).values([
          { userId: actor.account.id, event: 'admin.user.delete_actor', requestId },
          { userId: id, event: 'admin.user.delete.' + input.mode, requestId },
        ]);
        await rememberResult(tx, actor, operation, key, command, id);
      },
      true,
    );
    return { data: { message: '账号已删除' } };
  }
  role(
    actor: Identity,
    id: string,
    input: z.infer<typeof SetAdminUserRoleSchema>,
    key: string,
    requestId: string,
  ) {
    return this.apply(actor, id, { action: 'set_role', input }, key, requestId);
  }
  status(
    actor: Identity,
    id: string,
    input: z.infer<typeof SetAdminUserStatusSchema>,
    key: string,
    requestId: string,
  ) {
    return this.apply(actor, id, { action: 'set_status', input }, key, requestId);
  }
  revokeSessions(
    actor: Identity,
    id: string,
    input: z.infer<typeof RevokeAdminUserSessionsSchema>,
    key: string,
    requestId: string,
  ) {
    return this.apply(actor, id, { action: 'revoke_sessions', input }, key, requestId);
  }
  private apply(actor: Identity, id: string, command: Command, key: string, requestId: string) {
    return userManagementTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true);
        const operation = 'admin.user.' + command.action;
        const requestHash = contentHash({ id, ...command });
        const [previous] = await tx
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.actorId, actor.account.id),
              eq(idempotencyKeys.operation, operation),
              eq(idempotencyKeys.key, key),
            ),
          );
        if (previous) {
          if (previous.requestHash !== requestHash)
            throw new BusinessError('CONFLICT', '同一幂等标识对应不同请求，请重新确认操作');
          const [record] = await tx
            .select({ id: userManagementRecords.id })
            .from(userManagementRecords)
            .where(
              and(
                eq(userManagementRecords.id, previous.resultId),
                eq(userManagementRecords.actorId, actor.account.id),
                eq(userManagementRecords.targetId, id),
              ),
            );
          if (!record) throw new BusinessError('CONFLICT', '操作记录不可用，请先核对当前用户状态');
          return { data: await adminUserView(tx, id) };
        }
        const result = await applyUserAdministration(tx, actor, id, command, requestId);
        const record = { id: result.recordId };
        await tx
          .insert(idempotencyKeys)
          .values({ actorId: actor.account.id, operation, key, requestHash, resultId: record.id });
        return { data: await adminUserView(tx, id) };
      },
      true,
    );
  }
}
