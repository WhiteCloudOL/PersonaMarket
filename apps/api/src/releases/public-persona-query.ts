import { publicPublication } from './public-author.js';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  personas,
  personaReleases,
  releaseSubmissions,
  personaPublicProjection as projection,
  type Database,
} from '@personamarket/database';
import { interactionCountsSql } from '@personamarket/server';
import { publicCardSnapshot } from './public-card-fields.js';
import { personaCurationSql } from '../personas/persona-curation-sql.js';

/** 公开卡片的冻结版本连接与字段白名单；调用方仍须应用publicCurrentCondition */
export function publicPersonaCardQuery(
  reader: Pick<Database['db'], 'select'>,
  metric?: SQL<number>,
  heat?: { score: SQL<number>; likes: SQL<number>; favorites: SQL<number> },
) {
  return reader
    .select({
      curation: personaCurationSql(sql`${personas.id}`).as('curation'),
      interactionCounts: interactionCountsSql(sql`${personas.id}`).as('interaction_counts'),
      personaId: personas.id,
      releaseId: personaReleases.id,
      version: personaReleases.version,
      snapshot: publicCardSnapshot,
      publication: publicPublication,
      publishedAt: personaReleases.publishedAt,
      firstPublishedAt: personas.firstPublishedAt,
      metricCount: (metric ?? sql<number>`0`).as('metric_count'),
      heatScore: (heat?.score ?? sql<number>`0`).as('heat_score'),
      heatLikes: (heat?.likes ?? sql<number>`0`).as('heat_likes'),
      heatFavorites: (heat?.favorites ?? sql<number>`0`).as('heat_favorites'),
    })
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
        eq(releaseSubmissions.personaId, personas.id),
        eq(releaseSubmissions.releaseId, personaReleases.id),
      ),
    )
    .innerJoin(
      projection,
      and(
        eq(projection.personaId, personas.id),
        eq(projection.releaseId, personaReleases.id),
        eq(projection.searchReleaseId, personaReleases.id),
      ),
    );
}
