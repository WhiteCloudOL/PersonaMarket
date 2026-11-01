import { Inject, Injectable } from '@nestjs/common';
import { personas, users, type Database } from '@personamarket/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  AdminUsersResponseSchema,
  AdminUserPublicPersonasResponseSchema,
  AdminUserReviewRecordsResponseSchema,
  type AdminUserContentQuery,
  type AdminUserReviewRecordsQuery,
  type AdminUsersQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { userManagementTransaction } from './admin-users-transaction.js';
import { adminUserQueries, adminUserView } from './admin-user-views.js';
import { publicPersonaCardQuery } from '../releases/public-persona-query.js';
import { publicCurrentCondition } from '../releases/public-visibility.js';
import { adminUserReviewRecordsQuery } from './admin-user-record-queries.js';

@Injectable()
export class AdminUsersReadRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  list(actor: Identity, input: AdminUsersQuery) {
    return userManagementTransaction(this.database, async (tx) => {
      await lockIdentity(tx, actor, true, false);
      const query = adminUserQueries(input);
      const rows = await tx.execute<{ data: unknown }>(query.rows);
      const count = await tx.execute<{ value: number }>(query.total);
      return AdminUsersResponseSchema.parse({
        data: rows.rows.map((row) => row.data),
        meta: { page: input.page, pageSize: input.pageSize, total: count.rows[0]?.value ?? 0 },
      });
    });
  }
  detail(actor: Identity, id: string) {
    return userManagementTransaction(this.database, async (tx) => {
      await lockIdentity(tx, actor, true, false);
      return { data: await adminUserView(tx, id) };
    });
  }
  publicPersonas(actor: Identity, id: string, input: AdminUserContentQuery) {
    return userManagementTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, id));
        if (!target) throw new BusinessError('NOT_FOUND', '用户不存在或不可访问');
        const condition = and(publicCurrentCondition, eq(personas.ownerId, id));
        const matches = publicPersonaCardQuery(tx).where(condition).as('owned_public_personas');
        const [count] = await tx.select({ total: sql<number>`count(*)::integer` }).from(matches);
        const rows = await publicPersonaCardQuery(tx)
          .where(condition)
          .orderBy(desc(personas.firstPublishedAt), desc(personas.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize);
        return AdminUserPublicPersonasResponseSchema.parse({
          data: rows.map((row) => ({
            personaId: row.personaId,
            releaseId: row.releaseId,
            version: row.version,
            snapshot: row.snapshot,
            publication: row.publication,
            interactionCounts: row.interactionCounts,
            curation: row.curation,
            publishedAt: row.publishedAt?.toISOString(),
            firstPublishedAt: row.firstPublishedAt?.toISOString(),
            current: true,
          })),
          meta: {
            page: input.page,
            pageSize: input.pageSize,
            total: count?.total ?? 0,
            capped: false,
          },
        });
      },
      false,
      'repeatable read',
    );
  }
  reviewRecords(actor: Identity, id: string, input: AdminUserReviewRecordsQuery) {
    return userManagementTransaction(this.database, async (tx) => {
      await lockIdentity(tx, actor, true, false);
      const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, id));
      if (!target) throw new BusinessError('NOT_FOUND', '用户不存在或不可访问');
      const result = await tx.execute<{ data: unknown[]; total: number }>(
        adminUserReviewRecordsQuery(id, input),
      );
      return AdminUserReviewRecordsResponseSchema.parse({
        data: result.rows[0]?.data ?? [],
        meta: { page: input.page, pageSize: input.pageSize, total: result.rows[0]?.total ?? 0 },
      });
    });
  }
}
