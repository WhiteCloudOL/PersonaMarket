import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { idempotencyKeys, userManagementRecords, type Database } from '@personamarket/database';
import type {
  RevokeAdminUserSessionsSchema,
  SetAdminUserRoleSchema,
  SetAdminUserStatusSchema,
} from '@personamarket/contracts';
import { BusinessError, contentHash } from '@personamarket/server';
import type { z } from 'zod';
import { DATABASE } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { userManagementTransaction } from './admin-users-transaction.js';
import { adminUserView } from './admin-user-views.js';
import {
  applyUserAdministration,
  type UserManagementCommand as Command,
} from './user-administration.js';

@Injectable()
export class AdminUsersWriteRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
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
