import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  personas,
  personaReleases,
  releaseSubmissions,
  type Database,
} from '@personamarket/database';
import {
  SITEMAP_PAGE_SIZE,
  SITEMAP_MAX_PAGES,
  PublicSitemapIndexResponseSchema,
  PublicSitemapEntriesResponseSchema,
} from '@personamarket/contracts';
import { BusinessError, publicCurrentCondition } from '@personamarket/server';
import { DATABASE } from '../tokens.js';

type Reader = Pick<Database['db'], 'select'>;
function visiblePersonas(reader: Reader) {
  return reader
    .select({ personaId: personas.id, publishedAt: personaReleases.publishedAt })
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
    .where(publicCurrentCondition);
}

export function buildPublicSitemapEntriesQuery(reader: Reader, page: number) {
  // 先求公开集合再分页，避免循环外键的行数误估使有序LIMIT触发千万次嵌套循环
  const source = sql`(
    WITH sitemap_visible(persona_id,published_at) AS MATERIALIZED (${visiblePersonas(reader).getSQL()})
    SELECT persona_id,published_at FROM sitemap_visible
  ) AS sitemap_rows`;
  return reader
    .select({
      personaId: sql<string>`sitemap_rows.persona_id`,
      publishedAt: sql`sitemap_rows.published_at`.mapWith(personaReleases.publishedAt),
    })
    .from(source)
    .orderBy(asc(sql`sitemap_rows.persona_id`))
    .limit(SITEMAP_PAGE_SIZE)
    .offset((page - 1) * SITEMAP_PAGE_SIZE);
}

@Injectable()
export class SitemapRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private async read<T>(operation: (reader: Reader) => Promise<T>): Promise<T> {
    try {
      return await this.database.db.transaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL statement_timeout='2s'`);
          return operation(tx);
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
          throw new BusinessError('SERVICE_UNAVAILABLE', '站点地图读取暂时超时，请稍后重试', {
            cause,
            retryAfterSeconds: 1,
          });
      }
      throw cause;
    }
  }
  index() {
    return this.read(async (reader) => {
      const visible = visiblePersonas(reader).as('visible');
      const [row] = await reader.select({ total: sql<number>`count(*)::integer` }).from(visible);
      const total = row?.total ?? 0;
      if (total > SITEMAP_PAGE_SIZE * SITEMAP_MAX_PAGES)
        throw new BusinessError('SERVICE_UNAVAILABLE', '站点地图规模超过索引容量，请联系管理员');
      return PublicSitemapIndexResponseSchema.parse({
        data: { total, pageSize: SITEMAP_PAGE_SIZE, pages: Math.ceil(total / SITEMAP_PAGE_SIZE) },
      });
    });
  }
  entries(page: number) {
    return this.read(async (reader) => {
      const rows = await buildPublicSitemapEntriesQuery(reader, page);
      return PublicSitemapEntriesResponseSchema.parse({
        data: rows.map((row) => ({
          personaId: row.personaId,
          publishedAt: row.publishedAt?.toISOString(),
        })),
      });
    });
  }
}
