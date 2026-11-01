import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  personas,
  personaReleases,
  releaseSubmissions,
  exportSubjectDays,
  exportVersionSubjectDays,
  exportDailyMetrics,
  exportVersionDailyMetrics,
  type Database,
} from '@personamarket/database';
import {
  PublicStatisticsResponseSchema,
  PublicPersonaMetricsResponseSchema,
  type ExportFormat,
} from '@personamarket/contracts';
import { BusinessError, assertOrdinaryWriteAllowed } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { publicCurrentCondition, publicReleaseCondition } from './public-visibility.js';

@Injectable()
export class MetricsRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private visible() {
    return this.database.db
      .select({ id: personas.id, ownerId: personas.ownerId })
      .from(personas)
      .innerJoin(
        personaReleases,
        and(
          eq(personaReleases.personaId, personas.id),
          eq(personaReleases.id, personas.publishedReleaseId),
        ),
      )
      .innerJoin(
        releaseSubmissions,
        and(
          eq(releaseSubmissions.id, personaReleases.approvedSubmissionId),
          eq(releaseSubmissions.personaId, personas.id),
          eq(releaseSubmissions.releaseId, personaReleases.id),
        ),
      )
      .where(publicCurrentCondition);
  }
  async summary() {
    const visible = this.database.db.$with('visible').as(this.visible());
    const [row] = await this.database.db
      .with(visible)
      .select({
        personas: sql<number>`count(*)::integer`,
        creators: sql<number>`count(distinct ${visible.ownerId})::integer`,
        exports: sql<string>`(SELECT coalesce(sum(m.total_count),0)::text FROM export_daily_metrics m INNER JOIN visible v ON v.id=m.persona_id)`,
      })
      .from(visible);
    return PublicStatisticsResponseSchema.parse({
      data: {
        personas: row?.personas ?? 0,
        creators: row?.creators ?? 0,
        exports: Number(row?.exports ?? 0),
      },
    });
  }
  async persona(id: string) {
    const visible = this.database.db.$with('visible').as(this.visible());
    const [row] = await this.database.db
      .with(visible)
      .select({
        exports: sql<string>`coalesce(sum(${exportDailyMetrics.totalCount}),0)::text`,
      })
      .from(visible)
      .leftJoin(exportDailyMetrics, eq(exportDailyMetrics.personaId, visible.id))
      .where(eq(visible.id, id))
      .groupBy(visible.id);
    if (!row) throw new BusinessError('NOT_FOUND', '人设不存在或暂不可公开');
    return PublicPersonaMetricsResponseSchema.parse({ data: { exports: Number(row.exports) } });
  }
  async record(input: {
    personaId: string;
    releaseId: string;
    format: ExportFormat;
    day: string;
    subjectHash: string;
    accountId?: string;
  }) {
    await this.database.db.transaction(async (tx) => {
      await assertOrdinaryWriteAllowed(tx);
      // 与隐藏/下架串行；只有本次仍可提供的已审版本才能提交计数
      const [visible] = await tx
        .select({ ownerId: personas.ownerId })
        .from(personas)
        .innerJoin(
          personaReleases,
          and(eq(personaReleases.personaId, personas.id), eq(personaReleases.id, input.releaseId)),
        )
        .innerJoin(
          releaseSubmissions,
          and(
            eq(releaseSubmissions.id, personaReleases.approvedSubmissionId),
            eq(releaseSubmissions.personaId, personas.id),
            eq(releaseSubmissions.releaseId, personaReleases.id),
          ),
        )
        .where(and(publicReleaseCondition, eq(personas.id, input.personaId)))
        .for('share');
      if (!visible) throw new BusinessError('NOT_FOUND', '版本不存在或不可访问');
      const ranked = visible.ownerId === input.accountId ? 0 : 1;
      const [created] = await tx
        .insert(exportSubjectDays)
        .values({
          personaId: input.personaId,
          day: input.day,
          subjectHash: input.subjectHash,
          rankingEligible: ranked === 1,
        })
        .onConflictDoNothing()
        .returning({ id: exportSubjectDays.personaId });
      if (created)
        await tx
          .insert(exportDailyMetrics)
          .values({
            personaId: input.personaId,
            day: input.day,
            totalCount: 1,
            rankingCount: ranked,
          })
          .onConflictDoUpdate({
            target: [exportDailyMetrics.personaId, exportDailyMetrics.day],
            set: {
              totalCount: sql`${exportDailyMetrics.totalCount}+1`,
              rankingCount: sql`${exportDailyMetrics.rankingCount}+${ranked}`,
            },
          });
      const [version] = await tx
        .insert(exportVersionSubjectDays)
        .values({
          personaId: input.personaId,
          releaseId: input.releaseId,
          day: input.day,
          format: input.format,
          subjectHash: input.subjectHash,
        })
        .onConflictDoNothing()
        .returning({ id: exportVersionSubjectDays.releaseId });
      if (version)
        await tx
          .insert(exportVersionDailyMetrics)
          .values({
            personaId: input.personaId,
            releaseId: input.releaseId,
            day: input.day,
            format: input.format,
            totalCount: 1,
            rankingCount: ranked,
          })
          .onConflictDoUpdate({
            target: [
              exportVersionDailyMetrics.releaseId,
              exportVersionDailyMetrics.day,
              exportVersionDailyMetrics.format,
            ],
            set: {
              totalCount: sql`${exportVersionDailyMetrics.totalCount}+1`,
              rankingCount: sql`${exportVersionDailyMetrics.rankingCount}+${ranked}`,
            },
          });
    });
  }
}
