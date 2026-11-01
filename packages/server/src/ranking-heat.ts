import { sql, type SQL } from 'drizzle-orm';
import { users } from '@personamarket/database';
import {
  INTERACTION_RANKING_WEIGHTS,
  RANKING_HEAT_HALF_LIFE_SECONDS,
} from '@personamarket/contracts';

/** 保留exports-v1历史计算：滚动7天有效导出和7天半衰期，不改变旧快照口径 */
export function exportHeatCondition(cutoff: SQL, day: SQL, createdAt: SQL, eligible: SQL) {
  return sql`${eligible} AND ${createdAt} >= ${cutoff}-interval '7 days'
    AND ${createdAt} <= ${cutoff}
    AND ${day} >= (${cutoff} AT TIME ZONE 'UTC')::date-7
    AND ${day} <= (${cutoff} AT TIME ZONE 'UTC')::date`;
}

export function exportHeatDecay(cutoff: SQL, createdAt: SQL) {
  return sql<number>`power(0.5::double precision,extract(epoch FROM (${cutoff}-${createdAt}))/604800.0)`;
}

/** interactions-v1使用绝对小时窗口，避免会话时区或夏令时改变7/30天边界 */
export function interactionWindowCondition(cutoff: SQL, firstAddedAt: SQL, days: 7 | 30) {
  return sql`${firstAddedAt} >= ${cutoff}-(${days} * interval '24 hours') AND ${firstAddedAt} <= ${cutoff}`;
}

export function interactionRankingEligibility(
  cutoff: SQL,
  firstAddedAt: SQL,
  active: SQL,
  userId: SQL,
  ownerId: SQL,
) {
  return sql`${active} AND ${userId}<>${ownerId} AND ${firstAddedAt}<=${cutoff}
    AND EXISTS(SELECT 1 FROM ${users} WHERE ${users.id}=${userId}
      AND ${users.status}='active' AND ${users.emailVerifiedAt} IS NOT NULL)`;
}

export function interactionHeatDecay(cutoff: SQL, firstAddedAt: SQL) {
  return sql<number>`power(0.5::double precision,extract(epoch FROM (${cutoff}-${firstAddedAt}))/${RANKING_HEAT_HALF_LIFE_SECONDS}::double precision)`;
}

export function interactionExportHeatCondition(
  cutoff: SQL,
  day: SQL,
  createdAt: SQL,
  eligible: SQL,
) {
  return sql`${eligible} AND ${interactionWindowCondition(cutoff, createdAt, 7)}
    AND ${day}>=(${cutoff} AT TIME ZONE 'UTC')::date-7
    AND ${day}<=(${cutoff} AT TIME ZONE 'UTC')::date`;
}

export function combinedRankingHeat(
  exports: SQL,
  likes: SQL,
  favorites: SQL,
  weights: { likes: number; favorites: number; exports: number } = INTERACTION_RANKING_WEIGHTS,
) {
  return sql<number>`(coalesce(${exports},0)*${weights.exports}
    +coalesce(${likes},0)*${weights.likes}
    +coalesce(${favorites},0)*${weights.favorites})`;
}
