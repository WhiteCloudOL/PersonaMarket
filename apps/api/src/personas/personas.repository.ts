import { Inject, Injectable } from '@nestjs/common';
import { and, eq, desc, asc, sql, count } from 'drizzle-orm';
import {
  categories,
  tags,
  personas,
  personaDrafts,
  siteSettings,
  type Database,
} from '@personamarket/database';
import {
  ContentLimitsSchema,
  SubmissionSettingsSchema,
  PersonaDraftSchema,
  emptyPersonaDraft,
  type PersonaDraft,
  type Platform,
  type CreatePersonaRequest,
} from '@personamarket/contracts';
import {
  BusinessError,
  assertPersonaPayloadBudget,
  assertOrdinaryWriteAllowed,
} from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { setDraftAssetReferences } from '../assets/asset-links.js';

@Injectable()
export class PersonasRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  async owned(transaction: Transaction, id: string, actor: Identity) {
    const [persona] = await transaction
      .select()
      .from(personas)
      .where(and(eq(personas.id, id), eq(personas.ownerId, actor.account.id)))
      .for('update');
    if (!persona) throw new BusinessError('NOT_FOUND', '人设不存在或不可访问');
    return persona;
  }
  async create(actor: Identity, input: CreatePersonaRequest) {
    return this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      return this.createWithin(tx, actor, input, input.initialDraft);
    });
  }
  async createWithin(
    tx: Transaction,
    actor: Identity,
    input: { platform: Platform; title: string },
    draft?: PersonaDraft,
  ) {
    await assertOrdinaryWriteAllowed(tx);
    const [setting] = await tx
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, 'submissions'))
      .for('share');
    const submissions = SubmissionSettingsSchema.parse(setting?.value);
    if (!submissions.enabled || !submissions.platforms.includes(input.platform))
      throw new BusinessError('FORBIDDEN', '此平台暂未开放新作品，已有草稿可以继续编辑');
    const [total] = await tx
      .select({ value: count() })
      .from(personas)
      .where(eq(personas.ownerId, actor.account.id));
    if ((total?.value ?? 0) >= 100)
      throw new BusinessError('CONFLICT', '已达到每个账号 100 个人设的上限');
    const [row] = await tx
      .insert(personas)
      .values({ ownerId: actor.account.id, platform: input.platform })
      .returning();
    if (!row) throw new Error('PERSONA_INSERT_FAILED');
    const payload = PersonaDraftSchema.parse(
      draft ?? emptyPersonaDraft(input.platform, input.title),
    );
    if (payload.platform !== input.platform || payload.title !== input.title)
      throw new BusinessError('INVALID_INPUT', '初始草稿与创建请求不一致');
    await assertPersonaPayloadBudget(tx, payload);
    await tx.insert(personaDrafts).values({
      personaId: row.id,
      payload,
    });
    if (draft) await setDraftAssetReferences(tx, actor.account.id, row.id, payload);
    return row.id;
  }
  async read(actor: Identity, id: string) {
    const [row] = await this.database.db
      .select({ persona: personas, draft: personaDrafts })
      .from(personas)
      .innerJoin(personaDrafts, eq(personas.id, personaDrafts.personaId))
      .where(and(eq(personas.id, id), eq(personas.ownerId, actor.account.id)));
    if (!row) throw new BusinessError('NOT_FOUND', '人设不存在或不可访问');
    return {
      data: {
        id,
        draft: PersonaDraftSchema.parse(row.draft.payload),
        ownerVisibility: row.persona.ownerVisibility,
        moderationState: row.persona.moderationState,
        updatedAt: row.draft.updatedAt.toISOString(),
      },
      meta: { revision: row.draft.revision },
    };
  }
  async save(actor: Identity, id: string, payload: PersonaDraft, expected: number) {
    return this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      return this.saveWithin(tx, actor, id, payload, expected);
    });
  }
  async saveWithin(
    tx: Transaction,
    actor: Identity,
    id: string,
    payload: PersonaDraft,
    expected: number,
  ) {
    await assertOrdinaryWriteAllowed(tx);
    const persona = await this.owned(tx, id, actor);
    if (payload.platform !== persona.platform)
      throw new BusinessError('INVALID_INPUT', '创建后不能修改人设平台');
    await assertPersonaPayloadBudget(tx, payload);
    await setDraftAssetReferences(tx, actor.account.id, id, payload);
    const [row] = await tx
      .update(personaDrafts)
      .set({ payload, revision: sql`${personaDrafts.revision}+1`, updatedAt: new Date() })
      .where(and(eq(personaDrafts.personaId, id), eq(personaDrafts.revision, expected)))
      .returning();
    if (!row)
      throw new BusinessError('REVISION_CONFLICT', '其他页面已保存更新，请对比服务器草稿后重试');
    await tx.update(personas).set({ updatedAt: new Date() }).where(eq(personas.id, id));
    return {
      data: {
        id,
        draft: payload,
        ownerVisibility: persona.ownerVisibility,
        moderationState: persona.moderationState,
        updatedAt: row.updatedAt.toISOString(),
      },
      meta: { revision: row.revision },
    };
  }
  async list(actor: Identity, page: number, pageSize: number) {
    const rows = await this.database.db
      .select({
        persona: personas,
        payload: personaDrafts.payload,
        latestSubmissionStatus: sql<
          string | null
        >`(SELECT status FROM release_submissions WHERE persona_id=${personas.id} ORDER BY created_at DESC,id DESC LIMIT 1)`,
      })
      .from(personas)
      .innerJoin(personaDrafts, eq(personas.id, personaDrafts.personaId))
      .where(eq(personas.ownerId, actor.account.id))
      .orderBy(desc(personas.updatedAt), desc(personas.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [total] = await this.database.db
      .select({ value: count() })
      .from(personas)
      .where(eq(personas.ownerId, actor.account.id));
    return {
      data: rows.map(({ persona, payload, latestSubmissionStatus }) => ({
        id: persona.id,
        platform: persona.platform,
        title: PersonaDraftSchema.parse(payload).title,
        ownerVisibility: persona.ownerVisibility,
        moderationState: persona.moderationState,
        publishedReleaseId: persona.publishedReleaseId,
        latestSubmissionStatus,
        updatedAt: persona.updatedAt.toISOString(),
      })),
      meta: { page, pageSize, total: total?.value ?? 0 },
    };
  }
  async taxonomy() {
    const [categoryRows, tagRows, settings] = await Promise.all([
      this.database.db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(eq(categories.active, true))
        .orderBy(asc(categories.sortOrder), asc(categories.name), asc(categories.id)),
      this.database.db
        .select({ id: tags.id, name: tags.name })
        .from(tags)
        .where(and(eq(tags.active, true), eq(tags.userCreated, false)))
        .orderBy(asc(tags.sortOrder), asc(tags.name), asc(tags.id)),
      this.database.db.query.siteSettings.findFirst({
        where: eq(siteSettings.key, 'contentLimits'),
      }),
    ]);
    return {
      data: {
        categories: categoryRows,
        tags: tagRows,
        contentLimits: ContentLimitsSchema.parse(settings?.value),
      },
    };
  }
}
