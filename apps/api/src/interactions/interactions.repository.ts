import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import {
  personaLikes,
  personaFavorites,
  personas,
  personaReleases,
  releaseSubmissions,
  personaPublicProjection as projection,
  siteSettings,
  type Database,
} from '@personamarket/database';
import {
  InteractionResponseSchema,
  InteractionSettingsSchema,
  OwnInteractionsResponseSchema,
  FavoritesResponseSchema,
  PublicPersonaCardSchema,
  type FavoritesQuery,
} from '@personamarket/contracts';
import {
  BusinessError,
  interactionCountsSql,
  publicCurrentCondition,
  assertOrdinaryWriteAllowed,
} from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { personaCurationSql } from '../personas/persona-curation-sql.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { publicCardSnapshot } from '../releases/public-card-fields.js';

async function settings(tx: Transaction) {
  const [row] = await tx
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.key, 'community'))
    .for('share');
  return InteractionSettingsSchema.parse(row?.value);
}
function ownState(userId: string) {
  return {
    personaId: personas.id,
    counts: interactionCountsSql(sql`${personas.id}`),
    liked: sql<boolean>`EXISTS (SELECT 1 FROM ${personaLikes} WHERE user_id=${userId} AND persona_id=${personas.id} AND active)`,
    favorited: sql<boolean>`EXISTS (SELECT 1 FROM ${personaFavorites} WHERE user_id=${userId} AND persona_id=${personas.id} AND active)`,
  };
}

@Injectable()
export class InteractionsRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}

  async states(actor: Identity, ids: string[]) {
    return this.database.db.transaction(async (tx) => {
      await lockIdentity(tx, actor, false, false);
      const configuration = await settings(tx);
      const data = await tx
        .select(ownState(actor.account.id))
        .from(personas)
        .innerJoin(
          personaReleases,
          and(
            eq(personas.publishedReleaseId, personaReleases.id),
            eq(personas.id, personaReleases.personaId),
          ),
        )
        .innerJoin(
          releaseSubmissions,
          and(
            eq(personaReleases.approvedSubmissionId, releaseSubmissions.id),
            eq(personas.id, releaseSubmissions.personaId),
            eq(personaReleases.id, releaseSubmissions.releaseId),
          ),
        )
        .where(and(publicCurrentCondition, inArray(personas.id, ids)));
      return OwnInteractionsResponseSchema.parse({ data, settings: configuration });
    });
  }

  async set(actor: Identity, id: string, kind: 'like' | 'favorite', enabled: boolean) {
    return this.database.db.transaction(async (tx) => {
      // 与账号管理和作品隐藏共用锁序，不能只信任事务外身份与可见性快照
      const { account } = await lockIdentity(tx, actor, false, false);
      if (!account.emailVerifiedAt)
        throw new BusinessError('FORBIDDEN', '验证邮箱后才可以点赞或收藏');
      await assertOrdinaryWriteAllowed(tx);
      const configuration = await settings(tx);
      const [persona] = await tx
        .select({ id: personas.id })
        .from(personas)
        .where(eq(personas.id, id))
        .for('update');
      if (!persona) throw new BusinessError('NOT_FOUND', '人设不存在或暂不可公开');
      const table = kind === 'like' ? personaLikes : personaFavorites;
      const relationship = and(eq(table.userId, account.id), eq(table.personaId, id));
      const [previous] = await tx.select().from(table).where(relationship);
      const [visible] = await tx
        .select({ id: personas.id })
        .from(personas)
        .innerJoin(
          personaReleases,
          and(
            eq(personas.publishedReleaseId, personaReleases.id),
            eq(personas.id, personaReleases.personaId),
          ),
        )
        .innerJoin(
          releaseSubmissions,
          and(
            eq(personaReleases.approvedSubmissionId, releaseSubmissions.id),
            eq(personas.id, releaseSubmissions.personaId),
            eq(personaReleases.id, releaseSubmissions.releaseId),
          ),
        )
        .where(and(eq(personas.id, id), publicCurrentCondition));
      // 只允许移除自己以前收藏的不可用作品，不向猜测ID的请求透露私有作品是否存在
      if (!visible && !(kind === 'favorite' && !enabled && previous))
        throw new BusinessError('NOT_FOUND', '人设不存在或暂不可公开');
      if (
        enabled &&
        !(kind === 'like' ? configuration.likesEnabled : configuration.favoritesEnabled)
      )
        throw new BusinessError(
          'FORBIDDEN',
          kind === 'like' ? '站点暂未开放新增点赞' : '站点暂未开放新增收藏',
        );
      if (!previous && enabled)
        await tx.insert(table).values({ userId: account.id, personaId: id });
      else if (previous && previous.active !== enabled)
        await tx
          .update(table)
          .set({ active: enabled, updatedAt: sql`clock_timestamp()` })
          .where(relationship);
      // 重试与取消/重加不改首次时间，不制造新的排行事件
      if (!visible)
        return InteractionResponseSchema.parse({
          data: { personaId: id, available: false, favorited: false },
          settings: configuration,
        });
      const [state] = await tx
        .select({ ...ownState(account.id), counts: interactionCountsSql(sql`${personas.id}`) })
        .from(personas)
        .where(eq(personas.id, id));
      return InteractionResponseSchema.parse({
        data: { ...state, available: true },
        settings: configuration,
      });
    });
  }

  async favorites(actor: Identity, input: FavoritesQuery) {
    return this.database.db
      .transaction(async (tx) => {
        await lockIdentity(tx, actor, false, false);
        await tx.execute(sql`SET LOCAL statement_timeout='2s'`);
        const visible = sql<boolean>`(${publicCurrentCondition}) IS TRUE`;
        const term = input.q.trim();
        const pattern = '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
        const condition = and(
          eq(personaFavorites.userId, actor.account.id),
          eq(personaFavorites.active, true),
          input.availability === 'available'
            ? visible
            : input.availability === 'unavailable'
              ? sql`NOT ${visible}`
              : undefined,
          input.platform ? and(visible, eq(personas.platform, input.platform)) : undefined,
          term ? and(visible, ilike(projection.title, pattern)) : undefined,
        );
        const query = () =>
          tx
            .select({
              personaId: personas.id,
              curation: personaCurationSql(sql`${personas.id}`).as('curation'),
              savedAt: personaFavorites.firstAddedAt,
              available: visible.as('available'),
              releaseId: personaReleases.id,
              version: personaReleases.version,
              snapshot: publicCardSnapshot,
              publication: releaseSubmissions.publication,
              publishedAt: personaReleases.publishedAt,
              firstPublishedAt: personas.firstPublishedAt,
              interactionCounts: interactionCountsSql(sql`${personas.id}`).as('interaction_counts'),
            })
            .from(personaFavorites)
            .innerJoin(personas, eq(personas.id, personaFavorites.personaId))
            .leftJoin(
              personaReleases,
              and(
                eq(personas.publishedReleaseId, personaReleases.id),
                eq(personas.id, personaReleases.personaId),
              ),
            )
            .leftJoin(
              releaseSubmissions,
              and(
                eq(personaReleases.approvedSubmissionId, releaseSubmissions.id),
                eq(personas.id, releaseSubmissions.personaId),
                eq(personaReleases.id, releaseSubmissions.releaseId),
              ),
            )
            .leftJoin(
              projection,
              and(
                eq(projection.personaId, personas.id),
                eq(projection.releaseId, personaReleases.id),
                eq(projection.searchReleaseId, personaReleases.id),
              ),
            )
            .where(condition);
        const [count] = await tx
          .select({ total: sql<number>`count(*)::integer` })
          .from(query().as('own_favorites'));
        const order =
          input.sort === 'oldest'
            ? [asc(personaFavorites.firstAddedAt), asc(personas.id)]
            : input.sort === 'updated'
              ? [
                  sql`CASE WHEN ${visible} THEN ${personaReleases.publishedAt} END DESC NULLS LAST`,
                  desc(personas.id),
                ]
              : input.sort === 'title'
                ? [
                    sql`CASE WHEN ${visible} THEN ${projection.title} END ASC NULLS LAST`,
                    desc(personas.id),
                  ]
                : [desc(personaFavorites.firstAddedAt), desc(personas.id)];
        const rows = await query()
          .orderBy(...order)
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize);
        return FavoritesResponseSchema.parse({
          data: rows.map((row) => ({
            personaId: row.personaId,
            savedAt: row.savedAt.toISOString(),
            available: row.available,
            ...(row.available
              ? {
                  persona: PublicPersonaCardSchema.parse({
                    curation: row.curation,
                    personaId: row.personaId,
                    releaseId: row.releaseId,
                    version: row.version,
                    snapshot: row.snapshot,
                    publication: row.publication,
                    publishedAt: row.publishedAt?.toISOString(),
                    firstPublishedAt: row.firstPublishedAt?.toISOString(),
                    current: true,
                    interactionCounts: row.interactionCounts,
                  }),
                }
              : {}),
          })),
          meta: { page: input.page, pageSize: input.pageSize, total: count?.total ?? 0 },
        });
      })
      .catch((cause: unknown) => {
        let current = cause;
        for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
          if ('code' in current && current.code === '57014')
            throw new BusinessError(
              'SERVICE_UNAVAILABLE',
              '收藏读取暂时超时，请稍后重试或缩小筛选范围',
              { cause, retryAfterSeconds: 1 },
            );
          current = current.cause;
        }
        throw cause;
      });
  }
}
