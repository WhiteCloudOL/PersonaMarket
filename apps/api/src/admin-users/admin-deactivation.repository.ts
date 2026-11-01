import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  authAuditEvents,
  authSessions,
  deactivationDecisions,
  deactivationRequests,
  idempotencyKeys,
  users,
  type Database,
} from '@personamarket/database';
import type { ReviewDeactivationRequestSchema } from '@personamarket/contracts';
import { BusinessError, contentHash } from '@personamarket/server';
import type { z } from 'zod';
import { DATABASE } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { userManagementTransaction } from './admin-users-transaction.js';
import { adminUserView } from './admin-user-views.js';

@Injectable()
export class AdminDeactivationRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  review(
    actor: Identity,
    id: string,
    applicationId: string,
    input: z.infer<typeof ReviewDeactivationRequestSchema>,
    key: string,
    requestId: string,
  ) {
    return userManagementTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true);
        const operation = 'admin.user.review_deactivation';
        const requestHash = contentHash({ id, applicationId, input });
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
            .select({ id: deactivationDecisions.id })
            .from(deactivationDecisions)
            .innerJoin(
              deactivationRequests,
              eq(deactivationRequests.id, deactivationDecisions.applicationId),
            )
            .where(
              and(
                eq(deactivationDecisions.id, previous.resultId),
                eq(deactivationDecisions.actorId, actor.account.id),
                eq(deactivationRequests.id, applicationId),
                eq(deactivationRequests.userId, id),
              ),
            );
          if (!record) throw new BusinessError('CONFLICT', '处理记录不可用，请先核对当前申请状态');
          return { data: await adminUserView(tx, id) };
        }
        const [target] = await tx
          .select({ id: users.id, status: users.status, securityVersion: users.securityVersion })
          .from(users)
          .where(eq(users.id, id))
          .for('update');
        if (!target) throw new BusinessError('NOT_FOUND', '用户不存在或不可访问');
        const [application] = await tx
          .select({ id: deactivationRequests.id, status: deactivationRequests.status })
          .from(deactivationRequests)
          .where(
            and(eq(deactivationRequests.id, applicationId), eq(deactivationRequests.userId, id)),
          )
          .for('update');
        if (!application) throw new BusinessError('NOT_FOUND', '停用申请不存在或不可访问');
        if (target.securityVersion !== input.expectedSecurityVersion)
          throw new BusinessError(
            'REVISION_CONFLICT',
            '用户状态已变化，输入已保留，请读取最新状态后核对',
          );
        if (application.status !== 'pending')
          throw new BusinessError('CONFLICT', '申请已撤回或已处理，请读取最新账号状态');
        let toStatus = target.status;
        let toSecurityVersion = target.securityVersion;
        let revokedSessions = 0;
        if (input.decision === 'approve') {
          if (target.status === 'deactivated')
            throw new BusinessError('CONFLICT', '账号已停用，请先核对申请记录');
          const [updated] = await tx
            .update(users)
            .set({ status: 'deactivated' })
            .where(eq(users.id, id))
            .returning({ status: users.status, securityVersion: users.securityVersion });
          if (!updated) throw new BusinessError('CONFLICT', '账号状态已变化，请重新核对申请');
          toStatus = updated.status;
          toSecurityVersion = updated.securityVersion;
          const revoked = await tx
            .update(authSessions)
            .set({ revokedAt: sql`clock_timestamp()` })
            .where(and(eq(authSessions.userId, id), isNull(authSessions.revokedAt)))
            .returning({ id: authSessions.id });
          revokedSessions = revoked.length;
        }
        await tx
          .update(deactivationRequests)
          .set({
            status: input.decision === 'approve' ? 'approved' : 'rejected',
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(deactivationRequests.id, applicationId));
        const [decision] = await tx
          .insert(deactivationDecisions)
          .values({
            applicationId,
            actorId: actor.account.id,
            decision: input.decision,
            reason: input.reason,
            fromStatus: target.status,
            toStatus,
            fromSecurityVersion: target.securityVersion,
            toSecurityVersion,
            revokedSessions,
            requestId,
          })
          .returning({ id: deactivationDecisions.id });
        if (!decision) throw new BusinessError('CONFLICT', '处理记录未保存，请重新核对申请');
        await tx
          .insert(authAuditEvents)
          .values({ userId: id, event: 'admin.user.deactivation_' + input.decision, requestId });
        await tx.insert(idempotencyKeys).values({
          actorId: actor.account.id,
          operation,
          key,
          requestHash,
          resultId: decision.id,
        });
        return { data: await adminUserView(tx, id) };
      },
      true,
    );
  }
}
