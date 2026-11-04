import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { personaCurations, personas, type Database } from '@personamarket/database';
import { AdminPersonaResponseSchema, type SetPersonaCuration } from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import type { Identity } from '../auth/auth.service.js';
import { lockIdentity } from '../auth/locked-identity.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import {
  idempotentResult,
  lockPersona,
  recordAction,
  rememberResult,
} from '../releases/release-helpers.js';
import { adminPersonaDetailQuery } from './admin-persona-queries.js';

@Injectable()
export class PersonaCurationRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}

  set(actor: Identity, id: string, input: SetPersonaCuration, key: string, requestId: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const persona = await lockPersona(tx, id);
        const selfReview = persona.ownerId === actor.account.id;
        if (selfReview && !input.selfReviewConfirmed)
          throw new BusinessError('FORBIDDEN', '管理自己的作品前请明确确认');
        const operation = 'persona.curation';
        const command = { id: id.toLowerCase(), ...input };
        const previous = await idempotentResult(tx, actor, operation, key, command);
        if (previous) {
          if (previous.toLowerCase() !== id.toLowerCase())
            throw new BusinessError('CONFLICT', '操作记录不可用，请重新核对人设');
          return { data: { message: '这次标记操作已处理，请核对当前状态' } };
        }
        if (persona.revision !== input.expectedRevision)
          throw new BusinessError('REVISION_CONFLICT', '人设状态已变化，请读取最新状态后核对');
        const result = await tx.execute<{ data: unknown }>(adminPersonaDetailQuery(id));
        const current = AdminPersonaResponseSchema.parse({ data: result.rows[0]?.data }).data;
        const adding =
          (!current.curation.official && input.official) ||
          (!current.curation.featured && input.featured);
        if (adding && !current.publiclyVisible)
          throw new BusinessError('CONFLICT', '只有当前公开的人设可以新增推荐标记');
        if (
          current.curation.official === input.official &&
          current.curation.featured === input.featured
        )
          throw new BusinessError('CONFLICT', '人设标记未变化，请核对当前状态');
        const values = {
          official: input.official,
          featured: input.featured,
          updatedById: actor.account.id,
          updatedAt: new Date(),
        };
        await tx
          .insert(personaCurations)
          .values({ personaId: id, ...values })
          .onConflictDoUpdate({ target: personaCurations.personaId, set: values });
        await tx
          .update(personas)
          .set({ revision: sql`${personas.revision}+1`, updatedAt: new Date() })
          .where(eq(personas.id, id));
        await recordAction(
          tx,
          actor,
          id,
          'persona_curated',
          input.reason,
          requestId,
          undefined,
          selfReview,
        );
        await rememberResult(tx, actor, operation, key, command, id);
        return { data: { message: '人设标记已更新' } };
      },
      { area: 'personas', serializeWrites: true },
    );
  }
}
