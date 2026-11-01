import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  rankingGenerations,
  rankingBoards,
  rankingEntries,
  personas,
  personaReleases,
  releaseSubmissions,
  type Database,
} from '@personamarket/database';
import {
  RANKING_ALGORITHM,
  CONFIGURABLE_RANKING_ALGORITHM,
  LEGACY_RANKING_ALGORITHM,
  RankingDefinitionSchema,
  RANKING_REFRESH_MS,
  RankingAlgorithmSchema,
  RankingListResponseSchema,
  type RankingQuery,
} from '@personamarket/contracts';
import { BusinessError, publicCurrentCondition, interactionCountsSql } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { publicCardSnapshot } from '../releases/public-card-fields.js';
import { personaCurationSql } from '../personas/persona-curation-sql.js';

type Reader = Pick<Database['db'], 'select'>;
function visibleEntries(reader: Reader, input: RankingQuery, generationId: string) {
  return reader
    .select({
      curation: personaCurationSql(sql`${personas.id}`).as('curation'),
      interactionCounts: interactionCountsSql(sql`${personas.id}`).as('interaction_counts'),
      personaId: sql<string>`${personas.id}`.as('persona_id'),
      releaseId: sql<string>`${personaReleases.id}`.as('release_id'),
      version: personaReleases.version,
      snapshot: publicCardSnapshot,
      publication: releaseSubmissions.publication,
      publishedAt: personaReleases.publishedAt,
      firstPublishedAt: personas.firstPublishedAt,
      position: sql<number>`row_number() OVER (ORDER BY ${rankingEntries.position})::integer`.as(
        'position',
      ),
      score: rankingEntries.score,
      eligibleExports: rankingEntries.eligibleExports,
      eligibleLikes: rankingEntries.eligibleLikes,
      eligibleFavorites: rankingEntries.eligibleFavorites,
    })
    .from(rankingEntries)
    .innerJoin(personas, eq(rankingEntries.personaId, personas.id))
    .innerJoin(
      personaReleases,
      and(
        eq(rankingEntries.releaseId, personaReleases.id),
        eq(personaReleases.personaId, personas.id),
      ),
    )
    .innerJoin(
      releaseSubmissions,
      and(
        eq(personaReleases.approvedSubmissionId, releaseSubmissions.id),
        eq(releaseSubmissions.personaId, personas.id),
        eq(releaseSubmissions.releaseId, personaReleases.id),
      ),
    )
    .where(
      and(
        publicCurrentCondition,
        eq(rankingEntries.generationId, generationId),
        eq(rankingEntries.kind, input.kind),
        eq(rankingEntries.window, input.window),
        eq(rankingEntries.platform, input.platform),
      ),
    );
}

@Injectable()
export class RankingsRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  async list(input: RankingQuery) {
    try {
      return await this.database.db.transaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL statement_timeout='2s'`);
          const [generation] = await tx
            .select({
              id: rankingGenerations.id,
              algorithm: rankingGenerations.algorithm,
              definition: rankingGenerations.definition,
              generatedAt: rankingGenerations.generatedAt,
              clock: sql<string>`clock_timestamp()`,
            })
            .from(rankingGenerations)
            .where(
              and(
                eq(rankingGenerations.status, 'completed'),
                !input.snapshotId && (input.kind === 'likes' || input.kind === 'favorites')
                  ? inArray(rankingGenerations.algorithm, [
                      RANKING_ALGORITHM,
                      CONFIGURABLE_RANKING_ALGORITHM,
                    ])
                  : input.window === 'newcomer'
                    ? eq(rankingGenerations.algorithm, CONFIGURABLE_RANKING_ALGORITHM)
                    : inArray(rankingGenerations.algorithm, RankingAlgorithmSchema.options),
                input.snapshotId ? eq(rankingGenerations.id, input.snapshotId) : undefined,
              ),
            )
            .orderBy(
              desc(
                sql`CASE WHEN ${rankingGenerations.algorithm}=${CONFIGURABLE_RANKING_ALGORITHM} THEN 2 WHEN ${rankingGenerations.algorithm}=${RANKING_ALGORITHM} THEN 1 ELSE 0 END`,
              ),
              sql`${rankingGenerations.settingsRevision} DESC NULLS LAST`,
              desc(rankingGenerations.generatedAt),
              desc(rankingGenerations.id),
            )
            .limit(1);
          if (!generation?.generatedAt) {
            if (input.snapshotId)
              throw new BusinessError('NOT_FOUND', '这批榜单已过期，请刷新排行榜后继续');
            throw new BusinessError('SERVICE_UNAVAILABLE', '排行榜正在准备，请稍后重试', {
              retryAfterSeconds: 5,
            });
          }
          const definition =
            generation.algorithm === CONFIGURABLE_RANKING_ALGORITHM
              ? RankingDefinitionSchema.parse(generation.definition)
              : undefined;
          if (
            input.window === 'newcomer' &&
            generation.algorithm !== CONFIGURABLE_RANKING_ALGORITHM
          )
            throw new BusinessError(
              'NOT_FOUND',
              '此旧批次不包含运营新作窗口，请选择近 30 天或刷新榜单',
            );
          if (
            generation.algorithm === LEGACY_RANKING_ALGORITHM &&
            (input.kind === 'likes' || input.kind === 'favorites')
          )
            throw new BusinessError('NOT_FOUND', '此旧批次不包含互动榜单，请刷新榜单');
          const refreshMs = definition
            ? definition.settings.refreshMinutes * 60_000
            : RANKING_REFRESH_MS;
          const [board] = await tx
            .select({ capped: rankingBoards.capped })
            .from(rankingBoards)
            .where(
              and(
                eq(rankingBoards.generationId, generation.id),
                eq(rankingBoards.kind, input.kind),
                eq(rankingBoards.window, input.window),
                eq(rankingBoards.platform, input.platform),
              ),
            )
            .limit(1);
          if (!board)
            throw new BusinessError('SERVICE_UNAVAILABLE', '榜单数据暂时不可用，请稍后重试', {
              retryAfterSeconds: 5,
            });
          const visible = visibleEntries(tx, input, generation.id).as('visible_entries');
          const [count] = await tx.select({ total: sql<number>`count(*)::integer` }).from(visible);
          const rows = await tx
            .select()
            .from(visible)
            .orderBy(asc(visible.position))
            .limit(input.pageSize)
            .offset((input.page - 1) * input.pageSize);
          return RankingListResponseSchema.parse({
            data: rows.map((row) => ({
              ...row,
              publishedAt: row.publishedAt?.toISOString(),
              firstPublishedAt: row.firstPublishedAt?.toISOString(),
              current: true,
            })),
            meta: {
              snapshotId: generation.id,
              algorithm: generation.algorithm,
              generatedAt: generation.generatedAt.toISOString(),
              refreshAfter: new Date(generation.generatedAt.getTime() + refreshMs).toISOString(),
              kind: input.kind,
              window: input.window,
              platform: input.platform,
              page: input.page,
              pageSize: input.pageSize,
              total: count?.total ?? 0,
              stale:
                generation.generatedAt.getTime() + refreshMs < new Date(generation.clock).getTime(),
              limited: board.capped,
              entryLimit: definition?.settings.entryLimit ?? 1000,
              ...(definition ? { definition } : {}),
              windowDays:
                input.window === 'newcomer'
                  ? definition?.settings.newcomerWindowDays
                  : input.window === '7d'
                    ? 7
                    : input.window === '30d'
                      ? 30
                      : null,
            },
          });
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    } catch (cause) {
      for (
        let error = cause, depth = 0;
        depth < 5 && error instanceof Error;
        error = error.cause, depth++
      ) {
        if ('code' in error && error.code === '57014')
          throw new BusinessError('SERVICE_UNAVAILABLE', '榜单读取暂时超时，请稍后重试', {
            cause,
            retryAfterSeconds: 1,
          });
      }
      throw cause;
    }
  }
}
