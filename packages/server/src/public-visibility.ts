import { and, eq } from 'drizzle-orm';
import { personas, personaReleases, releaseSubmissions } from '@personamarket/database';

export const publicReleaseCondition = and(
  eq(personas.ownerVisibility, 'listed'),
  eq(personas.moderationState, 'normal'),
  eq(personaReleases.lifecycle, 'PUBLISHED'),
  eq(releaseSubmissions.status, 'APPROVED'),
);
export const publicCurrentCondition = and(
  publicReleaseCondition,
  eq(personas.publishedReleaseId, personaReleases.id),
);
