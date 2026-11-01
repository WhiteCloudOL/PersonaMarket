import { Inject, Injectable } from '@nestjs/common';
import { moderationRecords, personas, users, type Database } from '@personamarket/database';
import { desc, eq, sql } from 'drizzle-orm';
import {
  AdminPersonaResponseSchema,
  AdminPersonasResponseSchema,
  type AdminPersonasQuery,
  AdminPersonaRecordsResponseSchema,
  type AdminPersonaRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { lockIdentity } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { adminPersonaDetailQuery, adminPersonaListQueries } from './admin-persona-queries.js';

@Injectable()
export class AdminPersonasRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  records(actor: Identity, id: string, input: AdminPersonaRecordsQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const [persona] = await tx
          .select({ id: personas.id })
          .from(personas)
          .where(eq(personas.id, id));
        if (!persona) throw new BusinessError('NOT_FOUND', '人设不存在或不可访问');
        const condition = eq(moderationRecords.personaId, id);
        const rows = await tx
          .select({
            id: moderationRecords.id,
            actor: users.username,
            action: moderationRecords.action,
            reason: moderationRecords.reason,
            selfReview: moderationRecords.selfReview,
            submissionId: moderationRecords.submissionId,
            createdAt: moderationRecords.createdAt,
          })
          .from(moderationRecords)
          .innerJoin(users, eq(users.id, moderationRecords.actorId))
          .where(condition)
          .orderBy(desc(moderationRecords.createdAt), desc(moderationRecords.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize);
        const [count] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(moderationRecords)
          .where(condition);
        return AdminPersonaRecordsResponseSchema.parse({
          data: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
          meta: { page: input.page, pageSize: input.pageSize, total: count?.total ?? 0 },
        });
      },
      { area: 'personas', isolationLevel: 'repeatable read' },
    );
  }
  list(actor: Identity, input: AdminPersonasQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const query = adminPersonaListQueries(input);
        const rows = await tx.execute<{ data: unknown }>(query.rows);
        const count = await tx.execute<{ total: number }>(query.total);
        return AdminPersonasResponseSchema.parse({
          data: rows.rows.map((row) => row.data),
          meta: { page: input.page, pageSize: input.pageSize, total: count.rows[0]?.total ?? 0 },
        });
      },
      { area: 'personas', isolationLevel: 'repeatable read' },
    );
  }
  detail(actor: Identity, id: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const result = await tx.execute<{ data: unknown }>(adminPersonaDetailQuery(id));
        if (!result.rows[0]) throw new BusinessError('NOT_FOUND', '人设不存在或不可访问');
        return AdminPersonaResponseSchema.parse({ data: result.rows[0].data });
      },
      { area: 'personas' },
    );
  }
}
