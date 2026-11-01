import { sql } from 'drizzle-orm';
import type { Database } from '@personamarket/database';
import { RANKING_ENTRY_LIMIT } from '@personamarket/contracts';
import { publicCurrentCondition } from './public-visibility.js';
import { exportHeatCondition, exportHeatDecay } from './ranking-heat.js';

type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

/** 一次计算所有18个榜单；有界结果直接写入数据库，不把事件或作品正文拉到Worker */
export async function calculateLegacyRankingEntries(
  tx: Transaction,
  generationId: string,
  at: Date,
) {
  await tx.execute(sql`INSERT INTO ranking_boards(generation_id,kind,"window",platform,entry_count,capped)
    SELECT ${generationId}::uuid,k.kind,k.win,p.platform,0,false
    FROM (VALUES ('hot','7d'),('downloads','7d'),('downloads','30d'),('downloads','all'),('new','30d'),('updated','all')) AS k(kind,win)
    CROSS JOIN (VALUES ('all'),('maibot'),('astrbot')) AS p(platform)`);
  await tx.execute(legacyRankingCalculationSql(generationId, at));
}

/** 每板先取前1001项再编排名次，多取一项判断截断；共用SQL供运维EXPLAIN而不发布快照 */
export function legacyRankingCalculationSql(generationId: string, at: Date) {
  return sql`
    WITH visible AS MATERIALIZED (
      SELECT personas.id AS persona_id,persona_releases.id AS release_id,personas.platform,
        personas.first_published_at,persona_releases.published_at,${at.toISOString()}::timestamptz AS cutoff_at
      FROM personas
      JOIN persona_releases ON persona_releases.persona_id=personas.id AND persona_releases.id=personas.published_release_id
      JOIN release_submissions ON release_submissions.id=persona_releases.approved_submission_id
        AND release_submissions.persona_id=personas.id AND release_submissions.release_id=persona_releases.id
      WHERE ${publicCurrentCondition} AND personas.first_published_at IS NOT NULL
        AND personas.first_published_at <= ${at.toISOString()}::timestamptz
        AND persona_releases.published_at <= ${at.toISOString()}::timestamptz
    ), daily AS MATERIALIZED (
      SELECT m.persona_id,
        sum(m.ranking_count) FILTER (WHERE m.day >= (v.cutoff_at AT TIME ZONE 'UTC')::date-6) AS count7,
        sum(m.ranking_count) FILTER (WHERE m.day >= (v.cutoff_at AT TIME ZONE 'UTC')::date-29) AS count30,
        sum(m.ranking_count) AS count_all
      FROM export_daily_metrics m JOIN visible v ON v.persona_id=m.persona_id
      WHERE m.day <= (v.cutoff_at AT TIME ZONE 'UTC')::date GROUP BY m.persona_id
    ), heat AS MATERIALIZED (
      SELECT e.persona_id,count(*) AS count7,
        sum(${exportHeatDecay(sql`v.cutoff_at`, sql`e.created_at`)}) AS score
      FROM export_subject_days e JOIN visible v ON v.persona_id=e.persona_id
      WHERE ${exportHeatCondition(sql`v.cutoff_at`, sql`e.day`, sql`e.created_at`, sql`e.ranking_eligible`)} GROUP BY e.persona_id
    ), facts AS MATERIALIZED (
      SELECT v.*,coalesce(d.count7,0)::bigint AS count7,coalesce(d.count30,0)::bigint AS count30,
        coalesce(d.count_all,0)::bigint AS count_all,coalesce(h.score,0) AS heat,
        coalesce(h.count7,0)::bigint AS heat_count7
      FROM visible v LEFT JOIN daily d ON d.persona_id=v.persona_id LEFT JOIN heat h ON h.persona_id=v.persona_id
    ), ranked AS MATERIALIZED (
      SELECT k.kind,k.win,p.platform AS scope,r.*
      FROM (VALUES ('hot','7d'),('downloads','7d'),('downloads','30d'),('downloads','all'),('new','30d'),('updated','all')) AS k(kind,win)
      CROSS JOIN (VALUES ('all'),('maibot'),('astrbot')) AS p(platform)
      CROSS JOIN LATERAL (
        SELECT bounded.*,row_number() OVER (ORDER BY bounded.score DESC,bounded.first_published_at DESC,bounded.persona_id DESC) AS position
        FROM (
          SELECT f.persona_id,f.release_id,f.first_published_at,
            CASE WHEN k.kind='hot' THEN f.heat
              WHEN k.kind='new' THEN extract(epoch FROM f.first_published_at)
              WHEN k.kind='updated' THEN extract(epoch FROM f.published_at)
              WHEN k.win='7d' THEN f.count7 WHEN k.win='30d' THEN f.count30 ELSE f.count_all END::double precision AS score,
            CASE WHEN k.kind='hot' THEN f.heat_count7
              WHEN k.kind='downloads' AND k.win='7d' THEN f.count7
              WHEN k.kind='downloads' AND k.win='30d' THEN f.count30 ELSE f.count_all END AS eligible_exports
          FROM facts f
          WHERE (p.platform='all' OR p.platform=f.platform)
            AND (k.kind<>'hot' OR f.heat>0)
            AND (k.kind<>'new' OR f.first_published_at >= f.cutoff_at-interval '30 days')
            AND (k.kind<>'downloads' OR CASE k.win WHEN '7d' THEN f.count7 WHEN '30d' THEN f.count30 ELSE f.count_all END > 0)
          ORDER BY score DESC,f.first_published_at DESC,f.persona_id DESC
          LIMIT ${RANKING_ENTRY_LIMIT + 1}
        ) bounded
      ) r
    ), written AS (
      INSERT INTO ranking_entries(generation_id,kind,"window",platform,position,persona_id,release_id,score,eligible_exports)
      SELECT ${generationId}::uuid,kind,win,scope,position::integer,persona_id,release_id,score,eligible_exports
      FROM ranked WHERE position <= ${RANKING_ENTRY_LIMIT} RETURNING generation_id
    )
    UPDATE ranking_boards b SET entry_count=least(c.raw_count,${RANKING_ENTRY_LIMIT})::integer,capped=c.raw_count>${RANKING_ENTRY_LIMIT}
    FROM (SELECT kind,win,scope,max(position) AS raw_count FROM ranked GROUP BY kind,win,scope) c
    WHERE b.generation_id=${generationId}::uuid AND b.kind=c.kind AND b."window"=c.win AND b.platform=c.scope
  `;
}
