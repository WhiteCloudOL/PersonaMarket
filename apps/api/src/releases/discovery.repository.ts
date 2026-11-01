import { Inject, Injectable } from '@nestjs/common';
import { and, eq, asc, desc, ilike, sql } from 'drizzle-orm';
import {
  personas,
  personaReleases,
  releaseSubmissions,
  personaPublicProjection as projection,
  exportDailyMetrics,
  users,
  type Database,
} from '@personamarket/database';
import {
  PUBLIC_SEARCH_RESULT_LIMIT,
  RANKING_ALGORITHM,
  PublicPersonaListResponseSchema,
  publicPersonaTagIds,
  type PublicPersonaQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { publicCurrentCondition } from './public-visibility.js';
import { publicPersonaCardQuery as visibleQuery } from './public-persona-query.js';
import { discoveryHeatFacts, discoveryInteractionFacts } from './discovery-heat-query.js';

function timedOut(cause: unknown): boolean {
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    if ('code' in cause && cause.code === '57014') return true;
    cause = cause.cause;
  }
  return false;
}

@Injectable()
export class DiscoveryRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}

  async list(input: PublicPersonaQuery, ownerId?: string) {
    const term = input.q.trim();
    const pattern = '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
    const tagIds = publicPersonaTagIds(input);
    const conditions = and(
      publicCurrentCondition,
      ownerId ? eq(personas.ownerId, ownerId) : undefined,
      ownerId
        ? sql`EXISTS(SELECT 1 FROM ${users} WHERE ${users.id}=${ownerId} AND ${users.status}='active')`
        : undefined,
      input.featured
        ? sql`COALESCE((SELECT c.featured FROM persona_curations c WHERE c.persona_id=${personas.id}),false)=${input.featured === 'true'}`
        : undefined,
      input.platform ? eq(projection.platform, input.platform) : undefined,
      input.categoryId ? eq(projection.categoryId, input.categoryId) : undefined,
      tagIds.length ? sql`${projection.tagIds} @> ${sql.param(tagIds)}::uuid[]` : undefined,
      input.model
        ? sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${releaseSubmissions.snapshot}->'recommendedModels') model WHERE model->>'modelId'=${input.model})`
        : undefined,
      input.origin ? eq(projection.originType, input.origin) : undefined,
      input.redistribution ? eq(projection.redistribution, input.redistribution) : undefined,
      input.hasDialogue
        ? sql`${projection.dialogueCount} ${input.hasDialogue === 'true' ? sql`>` : sql`=`} 0`
        : undefined,
      input.publishedWithin !== 'all'
        ? sql`${personas.firstPublishedAt} >= now() - ${input.publishedWithin === '7d' ? 7 : 30} * interval '1 day'`
        : undefined,
      term ? ilike(projection.searchText, pattern) : undefined,
    );
    const rank = sql<number>`CASE
      WHEN lower(${projection.title})=lower(${term}) THEN 100
      WHEN EXISTS (SELECT 1 FROM unnest(${projection.tagNames}) t WHERE lower(t)=lower(${term})) THEN 90
      WHEN ${projection.title} ILIKE ${pattern} THEN 80
      WHEN EXISTS (SELECT 1 FROM unnest(${projection.tagNames}) t WHERE t ILIKE ${pattern}) THEN 70
      WHEN ${projection.summary} ILIKE ${pattern} THEN 60
      WHEN ${projection.authorNames} ILIKE ${pattern} THEN 50
      WHEN ${projection.modelNames} ILIKE ${pattern} THEN 40
      ELSE 10 END`;
    const publishedOrder = [desc(personas.firstPublishedAt), desc(personas.id)];
    const facts = input.sort === 'hot' ? discoveryHeatFacts(this.database.db) : undefined;
    const social =
      input.sort === 'likes' || input.sort === 'favorites'
        ? discoveryInteractionFacts(this.database.db, input.sort)
        : undefined;
    const heat = facts
      ? {
          score: facts.score,
          likes: sql<number>`${facts.likes.count}`.mapWith(Number),
          favorites: sql<number>`${facts.favorites.count}`.mapWith(Number),
        }
      : undefined;
    const metricWindow = input.sort === 'recent-downloads' ? '7d' : 'all';
    const metric = facts
      ? sql<number>`${facts.exports.count}`.mapWith(Number)
      : social
        ? sql<number>`${social.count}`.mapWith(Number)
        : input.sort === 'downloads' || input.sort === 'recent-downloads'
          ? sql<number>`COALESCE((
          SELECT sum(${exportDailyMetrics.rankingCount}) FROM ${exportDailyMetrics}
          WHERE ${exportDailyMetrics.personaId}=${personas.id}
          AND ${exportDailyMetrics.day} <= (now() AT TIME ZONE 'UTC')::date
          ${metricWindow === '7d' ? sql`AND ${exportDailyMetrics.day} >= (now() AT TIME ZONE 'UTC')::date - 6` : sql``}
        ),0)`.mapWith(Number)
          : undefined;
    const score = heat?.score ?? metric;
    const order = score
      ? [desc(score), ...publishedOrder]
      : input.sort === 'title'
        ? [asc(projection.title), asc(personas.id)]
        : input.sort === 'oldest'
          ? [asc(personas.firstPublishedAt), asc(personas.id)]
          : input.sort === 'updated'
            ? [desc(personaReleases.publishedAt), desc(personas.id)]
            : input.sort === 'relevance' && term
              ? [desc(rank), ...publishedOrder]
              : publishedOrder;
    try {
      return await this.database.db.transaction(
        async (tx) => {
          // SET LOCAL 与事务快照防止超时配置泄漏到连接池，行和计数使用同一可见资格
          await tx.execute(sql`SET LOCAL statement_timeout='2s'`);
          const bounded = visibleQuery(tx)
            .where(conditions)
            .limit(term ? PUBLIC_SEARCH_RESULT_LIMIT + 1 : 2_147_483_647)
            .as('matches');
          const [counted] = await tx
            .select({ total: sql<number>`count(*)::integer` })
            .from(bounded);
          const rawTotal = counted?.total ?? 0;
          const total = term ? Math.min(rawTotal, PUBLIC_SEARCH_RESULT_LIMIT) : rawTotal;
          const offset = (input.page - 1) * input.pageSize;
          const query = visibleQuery(tx, metric, heat).$dynamic();
          const rankedQuery = facts
            ? query
                .leftJoinLateral(facts.exports, sql`true`)
                .leftJoinLateral(facts.likes, sql`true`)
                .leftJoinLateral(facts.favorites, sql`true`)
            : social
              ? query.leftJoinLateral(social, sql`true`)
              : query;
          const rows = await rankedQuery
            .where(conditions)
            .orderBy(...order)
            .limit(
              term ? Math.min(input.pageSize, PUBLIC_SEARCH_RESULT_LIMIT - offset) : input.pageSize,
            )
            .offset(offset);
          return PublicPersonaListResponseSchema.parse({
            data: rows.map(({ metricCount, heatScore, heatLikes, heatFavorites, ...row }) => ({
              ...row,
              publishedAt: row.publishedAt?.toISOString(),
              firstPublishedAt: row.firstPublishedAt?.toISOString(),
              current: true,
              ...(heat
                ? {
                    heatMetric: {
                      score: heatScore,
                      eligibleExports: metricCount,
                      eligibleLikes: heatLikes,
                      eligibleFavorites: heatFavorites,
                      algorithm: RANKING_ALGORITHM,
                    },
                  }
                : input.sort === 'likes' || input.sort === 'favorites'
                  ? { interactionMetric: { kind: input.sort, eligibleCount: metricCount } }
                  : metric
                    ? { exportMetric: { eligibleExports: metricCount, window: metricWindow } }
                    : {}),
            })),
            meta: {
              page: input.page,
              pageSize: input.pageSize,
              total,
              capped: term.length > 0 && rawTotal > total,
            },
          });
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    } catch (cause) {
      if (timedOut(cause))
        throw new BusinessError('SERVICE_UNAVAILABLE', '搜索耗时较长，请增加关键词或缩小筛选范围', {
          cause,
          retryAfterSeconds: 1,
        });
      throw cause;
    }
  }
}
