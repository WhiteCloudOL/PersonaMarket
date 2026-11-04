import { sql } from 'drizzle-orm';
import { personas, releaseSubmissions, users } from '@personamarket/database';
import { DELETED_AUTHOR_LABEL } from '@personamarket/contracts';

export const publicPublication = sql<unknown>`CASE WHEN EXISTS (
  SELECT 1 FROM ${users} WHERE ${users.id}=${personas.ownerId} AND ${users.deletedAt} IS NOT NULL
) THEN jsonb_set(${releaseSubmissions.publication},'{publisher}',to_jsonb(${DELETED_AUTHOR_LABEL}::text))
ELSE ${releaseSubmissions.publication} END`;
