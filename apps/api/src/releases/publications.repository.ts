import { Inject, Injectable } from '@nestjs/common';
import { and, eq, desc, asc, inArray, sql } from 'drizzle-orm';
import {
  personas,
  personaReleases,
  releaseSubmissions,
  assetReferences,
  assets,
  type Database,
} from '@personamarket/database';
import { PublicReleaseSchema, type PublicPersonaQuery } from '@personamarket/contracts';
import { BusinessError, interactionCountsSql } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { publicReleaseCondition } from './public-visibility.js';
import { DiscoveryRepository } from './discovery.repository.js';
import { personaCurationSql } from '../personas/persona-curation-sql.js';
@Injectable()
export class PublicationsRepository {
  constructor(
    @Inject(DATABASE) readonly database: Database,
    @Inject(DiscoveryRepository) private readonly discovery: DiscoveryRepository,
  ) {}
  selection = {
    curation: personaCurationSql(sql`${personas.id}`),
    interactionCounts: interactionCountsSql(sql`${personas.id}`),
    personaId: personas.id,
    currentId: personas.publishedReleaseId,
    releaseId: personaReleases.id,
    version: personaReleases.version,
    snapshot: releaseSubmissions.snapshot,
    publication: releaseSubmissions.publication,
    changelog: releaseSubmissions.changelog,
    publishedAt: personaReleases.publishedAt,
  };
  query() {
    return this.database.db
      .select(this.selection)
      .from(personas)
      .innerJoin(
        personaReleases,
        and(eq(personas.id, personaReleases.personaId), eq(personaReleases.lifecycle, 'PUBLISHED')),
      )
      .innerJoin(
        releaseSubmissions,
        and(
          eq(releaseSubmissions.id, personaReleases.approvedSubmissionId),
          eq(releaseSubmissions.personaId, personas.id),
          eq(releaseSubmissions.releaseId, personaReleases.id),
        ),
      );
  }
  view(row: {
    curation: unknown;
    interactionCounts: unknown;
    personaId: string;
    currentId: string | null;
    releaseId: string;
    version: string;
    snapshot: unknown;
    publication: unknown;
    changelog: string;
    publishedAt: Date | null;
  }) {
    if (!row.publishedAt) throw new Error('PUBLICATION_TIMESTAMP_MISSING');
    return PublicReleaseSchema.parse({
      curation: row.curation,
      interactionCounts: row.interactionCounts,
      personaId: row.personaId,
      releaseId: row.releaseId,
      version: row.version,
      snapshot: row.snapshot,
      publication: row.publication,
      changelog: row.changelog,
      publishedAt: row.publishedAt.toISOString(),
      current: row.currentId === row.releaseId,
    });
  }
  async current(id: string) {
    const [row] = await this.query().where(
      and(
        publicReleaseCondition,
        eq(personas.id, id),
        eq(personas.publishedReleaseId, personaReleases.id),
      ),
    );
    if (!row) throw new BusinessError('NOT_FOUND', '人设不存在或暂不可公开');
    return { data: this.view(row) };
  }
  async release(id: string, releaseId: string) {
    const [row] = await this.query().where(
      and(publicReleaseCondition, eq(personas.id, id), eq(personaReleases.id, releaseId)),
    );
    if (!row) throw new BusinessError('NOT_FOUND', '版本不存在或不可访问');
    return { data: this.view(row) };
  }
  async history(id: string, page: number) {
    await this.assertVisiblePersona(id);
    const rows = await this.query()
      .where(and(publicReleaseCondition, eq(personas.id, id)))
      .orderBy(desc(personaReleases.publishedAt), desc(personaReleases.id))
      .limit(20)
      .offset((page - 1) * 20);
    return { data: rows.map((row) => this.view(row)) };
  }
  async assertVisiblePersona(id: string) {
    const persona = await this.database.db.query.personas.findFirst({
      where: and(
        eq(personas.id, id),
        eq(personas.ownerVisibility, 'listed'),
        eq(personas.moderationState, 'normal'),
      ),
    });
    if (!persona) throw new BusinessError('NOT_FOUND', '人设不存在或暂不可公开');
  }
  list(input: PublicPersonaQuery) {
    return this.discovery.list(input);
  }
  async publicAsset(id: string) {
    const [row] = await this.database.db
      .select({ asset: assets })
      .from(assets)
      .innerJoin(
        assetReferences,
        and(
          eq(assetReferences.assetId, assets.id),
          eq(assetReferences.resourceType, 'submission'),
          eq(assetReferences.purpose, 'content'),
        ),
      )
      .innerJoin(releaseSubmissions, eq(releaseSubmissions.id, assetReferences.resourceId))
      .innerJoin(
        personaReleases,
        and(
          eq(personaReleases.approvedSubmissionId, releaseSubmissions.id),
          eq(personaReleases.id, releaseSubmissions.releaseId),
          eq(personaReleases.personaId, releaseSubmissions.personaId),
        ),
      )
      .innerJoin(
        personas,
        and(
          eq(personas.id, releaseSubmissions.personaId),
          eq(personas.id, assetReferences.personaId),
        ),
      )
      .where(and(publicReleaseCondition, eq(assets.id, id), eq(assets.purpose, 'content')))
      .limit(1);
    if (!row) throw new BusinessError('NOT_FOUND', '图片不存在或不可访问');
    return row.asset;
  }
  async exportAssets(personaId: string, releaseId: string, ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.database.db
      .select({ asset: assets })
      .from(personas)
      .innerJoin(personaReleases, eq(personaReleases.personaId, personas.id))
      .innerJoin(
        releaseSubmissions,
        and(
          eq(releaseSubmissions.id, personaReleases.approvedSubmissionId),
          eq(releaseSubmissions.releaseId, personaReleases.id),
          eq(releaseSubmissions.personaId, personas.id),
        ),
      )
      .innerJoin(
        assetReferences,
        and(
          eq(assetReferences.resourceType, 'submission'),
          eq(assetReferences.resourceId, releaseSubmissions.id),
          eq(assetReferences.personaId, personas.id),
          eq(assetReferences.purpose, 'content'),
        ),
      )
      .innerJoin(assets, and(eq(assets.id, assetReferences.assetId), eq(assets.purpose, 'content')))
      .where(
        and(
          publicReleaseCondition,
          eq(personas.id, personaId),
          eq(personaReleases.id, releaseId),
          inArray(assets.id, ids),
        ),
      )
      .orderBy(asc(assets.id));
    if (rows.length !== ids.length)
      throw new BusinessError('NOT_FOUND', '该版本的图片不存在或不可导出');
    return rows.map((row) => row.asset);
  }
  async reviewAsset(id: string) {
    const [row] = await this.database.db
      .select({ asset: assets })
      .from(assets)
      .innerJoin(
        assetReferences,
        and(eq(assetReferences.assetId, assets.id), eq(assetReferences.resourceType, 'submission')),
      )
      .innerJoin(
        releaseSubmissions,
        and(
          eq(releaseSubmissions.id, assetReferences.resourceId),
          eq(releaseSubmissions.personaId, assetReferences.personaId),
        ),
      )
      .where(eq(assets.id, id))
      .limit(1);
    if (!row) throw new BusinessError('NOT_FOUND', '素材未关联可审核的提交');
    return row.asset;
  }
}
