import { sql } from 'drizzle-orm';
import { personaLikes, personaFavorites, type Database } from '@personamarket/database';
import {
  LEGACY_RANKING_ALGORITHM,
  CONFIGURABLE_RANKING_ALGORITHM,
  RANKING_ALGORITHM,
  RANKING_ENTRY_LIMIT,
  RankingPlatformSchema,
  rankingBoardCombinations,
  type RankingAlgorithm,
  type RankingKind,
  type RankingDefinition,
} from '@personamarket/contracts';
import { publicCurrentCondition } from './public-visibility.js';
import { calculateLegacyRankingEntries } from './ranking-legacy-calculation.js';
import {
  combinedRankingHeat,
  interactionWindowCondition,
  interactionRankingEligibility,
  interactionHeatDecay,
  interactionExportHeatCondition,
} from './ranking-heat.js';

type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
/** 每组最多18板，限制单条写入和外键校验规模，整批仍由调用方同一事务提交 */
export const rankingCalculationGroups = [
  ['hot', 'downloads', 'new', 'updated'],
  ['likes', 'favorites'],
] as const satisfies readonly (readonly RankingKind[])[];
function dimensions(
  kinds?: readonly RankingKind[],
  algorithm: RankingAlgorithm = RANKING_ALGORITHM,
) {
  return {
    boards: sql.join(
      rankingBoardCombinations(algorithm)
        .filter(({ kind }) => !kinds || kinds.includes(kind))
        .map(({ kind, window }) => sql`(${kind}::text,${window}::text)`),
      sql`,`,
    ),
    platforms: sql.join(
      RankingPlatformSchema.options.map((platform) => sql`(${platform}::text)`),
      sql`,`,
    ),
  };
}

/** 关系只聚合当前有效且非本人的首次事实，不把私有收藏主体拉到Worker */
function relationshipFacts(table: typeof personaLikes | typeof personaFavorites) {
  const cutoff = sql`v.cutoff_at`,
    first = sql`r.first_added_at`;
  return sql`SELECT r.persona_id,
    count(*) FILTER (WHERE ${interactionWindowCondition(cutoff, first, 7)}) AS count7,
    count(*) FILTER (WHERE ${interactionWindowCondition(cutoff, first, 30)}) AS count30,
    count(*) AS count_all,
    sum(${interactionHeatDecay(cutoff, first)}) FILTER (WHERE ${interactionWindowCondition(cutoff, first, 7)}) AS heat
    FROM ${table} r JOIN visible v ON v.persona_id=r.persona_id
    WHERE ${interactionRankingEligibility(cutoff, first, sql`r.active`, sql`r.user_id`, sql`v.owner_id`)}
    GROUP BY r.persona_id`;
}

/** 实际批次版本决定计算；旧任务保持原导出SQL，新批次生成36板 */
export async function calculateRankingEntries(
  tx: Transaction,
  generationId: string,
  at: Date,
  algorithm: RankingAlgorithm = RANKING_ALGORITHM,
  definition?: RankingDefinition,
) {
  if (algorithm === LEGACY_RANKING_ALGORITHM)
    return calculateLegacyRankingEntries(tx, generationId, at);
  if ((algorithm === CONFIGURABLE_RANKING_ALGORITHM) !== Boolean(definition))
    throw Error('RANKING_DEFINITION_MISMATCH');
  const { boards, platforms } = dimensions(undefined, algorithm);
  await tx.execute(sql`INSERT INTO ranking_boards(generation_id,kind,"window",platform,entry_count,capped)
    SELECT ${generationId}::uuid,k.kind,k.win,p.platform,0,false
    FROM (VALUES ${boards}) AS k(kind,win) CROSS JOIN (VALUES ${platforms}) AS p(platform)`);
  for (const kinds of rankingCalculationGroups)
    await tx.execute(rankingCalculationSql(generationId, at, kinds, definition));
}

/** 单事务按快照时间聚合全部事实，每板只取1001项判断截断 */
export function rankingCalculationSql(
  generationId: string,
  at: Date,
  kinds?: readonly RankingKind[],
  definition?: RankingDefinition,
) {
  const { boards, platforms } = dimensions(
    kinds,
    definition ? CONFIGURABLE_RANKING_ALGORITHM : RANKING_ALGORITHM,
  );
  const limit = definition?.settings.entryLimit ?? RANKING_ENTRY_LIMIT;
  const newcomerDays = definition?.settings.newcomerWindowDays ?? 30;
  const newCutoff = definition
    ? sql`f.cutoff_at-((CASE WHEN k.win='newcomer' THEN ${newcomerDays} ELSE 30 END) * interval '24 hours')`
    : sql`f.cutoff_at-interval '30 days'`;
  return sql`WITH visible AS MATERIALIZED (
    SELECT personas.id AS persona_id,personas.owner_id,persona_releases.id AS release_id,personas.platform,
      personas.first_published_at,persona_releases.published_at,${at.toISOString()}::timestamptz AS cutoff_at
    FROM personas
    JOIN persona_releases ON persona_releases.persona_id=personas.id AND persona_releases.id=personas.published_release_id
    JOIN release_submissions ON release_submissions.id=persona_releases.approved_submission_id
      AND release_submissions.persona_id=personas.id AND release_submissions.release_id=persona_releases.id
    WHERE ${publicCurrentCondition} AND personas.first_published_at IS NOT NULL
      AND personas.first_published_at<=${at.toISOString()}::timestamptz
      AND persona_releases.published_at<=${at.toISOString()}::timestamptz
  ), daily AS MATERIALIZED (
    SELECT m.persona_id,
      sum(m.ranking_count) FILTER (WHERE m.day>=(v.cutoff_at AT TIME ZONE 'UTC')::date-6) AS count7,
      sum(m.ranking_count) FILTER (WHERE m.day>=(v.cutoff_at AT TIME ZONE 'UTC')::date-29) AS count30,
      sum(m.ranking_count) AS count_all
    FROM export_daily_metrics m JOIN visible v ON v.persona_id=m.persona_id
    WHERE m.day<=(v.cutoff_at AT TIME ZONE 'UTC')::date GROUP BY m.persona_id
  ), heat AS MATERIALIZED (
    SELECT e.persona_id,count(*) AS count7,
      sum(${interactionHeatDecay(sql`v.cutoff_at`, sql`e.created_at`)}) AS score
    FROM export_subject_days e JOIN visible v ON v.persona_id=e.persona_id
    WHERE ${interactionExportHeatCondition(sql`v.cutoff_at`, sql`e.day`, sql`e.created_at`, sql`e.ranking_eligible`)}
    GROUP BY e.persona_id
  ), likes AS MATERIALIZED (${relationshipFacts(personaLikes)}),
  favorites AS MATERIALIZED (${relationshipFacts(personaFavorites)}),
  facts AS MATERIALIZED (
    SELECT v.*,coalesce(d.count7,0)::bigint AS count7,coalesce(d.count30,0)::bigint AS count30,
      coalesce(d.count_all,0)::bigint AS count_all,coalesce(h.count7,0)::bigint AS heat_count7,
      coalesce(l.count7,0)::bigint AS likes7,coalesce(l.count30,0)::bigint AS likes30,coalesce(l.count_all,0)::bigint AS likes_all,
      coalesce(f.count7,0)::bigint AS favorites7,coalesce(f.count30,0)::bigint AS favorites30,coalesce(f.count_all,0)::bigint AS favorites_all,
      ${combinedRankingHeat(sql`h.score`, sql`l.heat`, sql`f.heat`, definition?.settings.weights)} AS heat
    FROM visible v LEFT JOIN daily d ON d.persona_id=v.persona_id LEFT JOIN heat h ON h.persona_id=v.persona_id
      LEFT JOIN likes l ON l.persona_id=v.persona_id LEFT JOIN favorites f ON f.persona_id=v.persona_id
  ), ranked AS MATERIALIZED (
    SELECT k.kind,k.win,p.platform AS scope,r.*
    FROM (VALUES ${boards}) AS k(kind,win) CROSS JOIN (VALUES ${platforms}) AS p(platform)
    CROSS JOIN LATERAL (
      SELECT bounded.*,row_number() OVER (ORDER BY bounded.score DESC,bounded.first_published_at DESC,bounded.persona_id DESC) AS position
      FROM (
        SELECT f.persona_id,f.release_id,f.first_published_at,
          CASE WHEN k.kind='hot' THEN f.heat
            WHEN k.kind='likes' THEN CASE k.win WHEN '7d' THEN f.likes7 WHEN '30d' THEN f.likes30 ELSE f.likes_all END
            WHEN k.kind='favorites' THEN CASE k.win WHEN '7d' THEN f.favorites7 WHEN '30d' THEN f.favorites30 ELSE f.favorites_all END
            WHEN k.kind='new' THEN extract(epoch FROM f.first_published_at)
            WHEN k.kind='updated' THEN extract(epoch FROM f.published_at)
            WHEN k.win='7d' THEN f.count7 WHEN k.win='30d' THEN f.count30 ELSE f.count_all END::double precision AS score,
          CASE WHEN k.kind='hot' THEN f.heat_count7 WHEN k.kind IN ('likes','favorites') THEN 0
            WHEN k.kind='downloads' AND k.win='7d' THEN f.count7
            WHEN k.kind='downloads' AND k.win='30d' THEN f.count30 ELSE f.count_all END AS eligible_exports,
          CASE WHEN k.kind='hot' THEN f.likes7 WHEN k.kind='likes' THEN
            CASE k.win WHEN '7d' THEN f.likes7 WHEN '30d' THEN f.likes30 ELSE f.likes_all END ELSE 0 END AS eligible_likes,
          CASE WHEN k.kind='hot' THEN f.favorites7 WHEN k.kind='favorites' THEN
            CASE k.win WHEN '7d' THEN f.favorites7 WHEN '30d' THEN f.favorites30 ELSE f.favorites_all END ELSE 0 END AS eligible_favorites
        FROM facts f
        WHERE (p.platform='all' OR p.platform=f.platform)
          AND (k.kind<>'hot' OR f.heat>0)
          AND (k.kind<>'new' OR f.first_published_at>=${newCutoff})
          AND (k.kind<>'downloads' OR CASE k.win WHEN '7d' THEN f.count7 WHEN '30d' THEN f.count30 ELSE f.count_all END>0)
          AND (k.kind<>'likes' OR CASE k.win WHEN '7d' THEN f.likes7 WHEN '30d' THEN f.likes30 ELSE f.likes_all END>0)
          AND (k.kind<>'favorites' OR CASE k.win WHEN '7d' THEN f.favorites7 WHEN '30d' THEN f.favorites30 ELSE f.favorites_all END>0)
        ORDER BY score DESC,f.first_published_at DESC,f.persona_id DESC LIMIT ${limit + 1}
      ) bounded
    ) r
  ), written AS (
    INSERT INTO ranking_entries(generation_id,kind,"window",platform,position,persona_id,release_id,score,eligible_exports,eligible_likes,eligible_favorites)
    SELECT ${generationId}::uuid,kind,win,scope,position::integer,persona_id,release_id,score,eligible_exports,eligible_likes,eligible_favorites
    FROM ranked WHERE position<=${limit} RETURNING generation_id
  )
  UPDATE ranking_boards b SET entry_count=least(c.raw_count,${limit})::integer,capped=c.raw_count>${limit}
  FROM (SELECT kind,win,scope,max(position) AS raw_count FROM ranked GROUP BY kind,win,scope) c
  WHERE b.generation_id=${generationId}::uuid AND b.kind=c.kind AND b."window"=c.win AND b.platform=c.scope`;
}
