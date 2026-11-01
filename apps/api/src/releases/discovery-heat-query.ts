import { and, eq, sql } from 'drizzle-orm';
import {
  exportSubjectDays,
  personaLikes,
  personaFavorites,
  personas,
  type Database,
} from '@personamarket/database';
import {
  combinedRankingHeat,
  interactionExportHeatCondition,
  interactionHeatDecay,
  interactionRankingEligibility,
  interactionWindowCondition,
} from '@personamarket/server';

function relationshipCondition(table: typeof personaLikes | typeof personaFavorites) {
  return and(
    eq(table.personaId, personas.id),
    interactionRankingEligibility(
      sql`now()`,
      sql`${table.firstAddedAt}`,
      sql`${table.active}`,
      sql`${table.userId}`,
      sql`${personas.ownerId}`,
    ),
  );
}

export function discoveryInteractionFacts(
  reader: Pick<Database['db'], 'select'>,
  kind: 'likes' | 'favorites',
) {
  const table = kind === 'likes' ? personaLikes : personaFavorites;
  return reader
    .select({ count: sql<number>`count(*)`.mapWith(Number).as('interaction_count') })
    .from(table)
    .where(relationshipCondition(table))
    .as('discovery_interaction_totals');
}

/** 每个候选作品各聚合一次计数和评分，由LATERAL连接复用，不读取收藏者身份 */
export function discoveryHeatFacts(reader: Pick<Database['db'], 'select'>) {
  const cutoff = sql`now()`;
  const exports = reader
    .select({
      count: sql<number>`count(*)`.mapWith(Number).as('export_count'),
      score:
        sql<number>`coalesce(sum(${interactionHeatDecay(cutoff, sql`${exportSubjectDays.createdAt}`)}),0)`
          .mapWith(Number)
          .as('export_heat'),
    })
    .from(exportSubjectDays)
    .where(
      and(
        eq(exportSubjectDays.personaId, personas.id),
        interactionExportHeatCondition(
          cutoff,
          sql`${exportSubjectDays.day}`,
          sql`${exportSubjectDays.createdAt}`,
          sql`${exportSubjectDays.rankingEligible}`,
        ),
      ),
    )
    .as('discovery_exports');
  function relationships(table: typeof personaLikes | typeof personaFavorites) {
    const metric = table === personaLikes ? 'likes' : 'favorites';
    return reader
      .select({
        count: sql<number>`count(*)`.mapWith(Number).as(metric + '_count'),
        score:
          sql<number>`coalesce(sum(${interactionHeatDecay(cutoff, sql`${table.firstAddedAt}`)}),0)`
            .mapWith(Number)
            .as(metric + '_heat'),
      })
      .from(table)
      .where(
        and(
          relationshipCondition(table),
          interactionWindowCondition(cutoff, sql`${table.firstAddedAt}`, 7),
        ),
      );
  }
  const likes = relationships(personaLikes).as('discovery_likes');
  const favorites = relationships(personaFavorites).as('discovery_favorites');
  return {
    exports,
    likes,
    favorites,
    score: combinedRankingHeat(
      sql`${exports.score}`,
      sql`${likes.score}`,
      sql`${favorites.score}`,
    ).mapWith(Number),
  };
}
