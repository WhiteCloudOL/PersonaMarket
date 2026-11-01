import { Inject, Injectable } from '@nestjs/common';
import { count, desc, eq, sql } from 'drizzle-orm';
import {
  siteSettings,
  siteSettingRecords,
  rankingGenerations,
  users,
  authAuditEvents,
  type Database,
} from '@personamarket/database';
import {
  RankingSettingsSchema,
  RankingSettingsResponseSchema,
  RankingSettingsRecordsResponseSchema,
  RankingRuntimeResponseSchema,
  defaultRankingSettings,
  type RankingSettingsWrite,
  type RankingSettingsRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError, enqueueConfiguredRankingRefreshInTransaction } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';

type Row = typeof siteSettings.$inferSelect;
type Generation = Pick<
  typeof rankingGenerations.$inferSelect,
  'id' | 'algorithm' | 'status' | 'definition' | 'requestedAt' | 'generatedAt' | 'errorCode'
>;
function runtimeGeneration(row: Generation | undefined) {
  return row
    ? {
        ...row,
        requestedAt: row.requestedAt.toISOString(),
        generatedAt: row.generatedAt?.toISOString() ?? null,
      }
    : null;
}

@Injectable()
export class RankingSettingsRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private async row(tx: Transaction, lock = false) {
    const query = tx.select().from(siteSettings).where(eq(siteSettings.key, 'rankings'));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new BusinessError('SERVICE_UNAVAILABLE', '排行与运营设置尚未完成初始化');
    return row;
  }
  private value(row: Row) {
    const parsed = RankingSettingsSchema.safeParse(row.value);
    if (!parsed.success)
      throw new BusinessError('INVALID_RESPONSE', '排行与运营设置暂时不可用，请联系管理员', {
        cause: parsed.error,
      });
    return parsed.data;
  }
  private async response(tx: Transaction, row: Row) {
    const [last] = await tx
      .select({ actor: users.username })
      .from(siteSettingRecords)
      .innerJoin(users, eq(users.id, siteSettingRecords.actorId))
      .where(eq(siteSettingRecords.key, 'rankings'))
      .orderBy(desc(siteSettingRecords.toRevision))
      .limit(1);
    return RankingSettingsResponseSchema.parse({
      data: this.value(row),
      defaults: defaultRankingSettings,
      meta: {
        revision: row.revision,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: last?.actor ?? null,
      },
    });
  }
  private latestGeneration(tx: Transaction, completed = false) {
    return tx
      .select({
        id: rankingGenerations.id,
        algorithm: rankingGenerations.algorithm,
        status: rankingGenerations.status,
        definition: rankingGenerations.definition,
        requestedAt: rankingGenerations.requestedAt,
        generatedAt: rankingGenerations.generatedAt,
        errorCode: rankingGenerations.errorCode,
      })
      .from(rankingGenerations)
      .where(completed ? eq(rankingGenerations.status, 'completed') : undefined)
      .orderBy(
        desc(sql`CASE ${rankingGenerations.algorithm}
          WHEN 'interactions-v2' THEN 2 WHEN 'interactions-v1' THEN 1 ELSE 0 END`),
        sql`${rankingGenerations.settingsRevision} DESC NULLS LAST`,
        desc(completed ? rankingGenerations.generatedAt : rankingGenerations.requestedAt),
        desc(rankingGenerations.id),
      )
      .limit(1);
  }
  read(actor: Identity) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        return this.response(tx, await this.row(tx));
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  runtime(actor: Identity) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const settings = await this.row(tx);
        const [latestRequest] = await this.latestGeneration(tx);
        const [latestCompleted] = await this.latestGeneration(tx, true);
        return RankingRuntimeResponseSchema.parse({
          data: {
            latestRequest: runtimeGeneration(latestRequest),
            latestCompleted: runtimeGeneration(latestCompleted),
          },
          meta: { settingsRevision: settings.revision },
        });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  records(actor: Identity, input: RankingSettingsRecordsQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const condition = eq(siteSettingRecords.key, 'rankings');
        const rows = await tx
          .select({
            id: siteSettingRecords.id,
            actor: users.username,
            reason: siteSettingRecords.reason,
            before: siteSettingRecords.beforeValue,
            after: siteSettingRecords.afterValue,
            fromRevision: siteSettingRecords.fromRevision,
            toRevision: siteSettingRecords.toRevision,
            createdAt: siteSettingRecords.createdAt,
          })
          .from(siteSettingRecords)
          .innerJoin(users, eq(users.id, siteSettingRecords.actorId))
          .where(condition)
          .orderBy(desc(siteSettingRecords.toRevision))
          .limit(20)
          .offset((input.page - 1) * 20);
        const [total] = await tx
          .select({ value: count() })
          .from(siteSettingRecords)
          .where(condition);
        return RankingSettingsRecordsResponseSchema.parse({
          data: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
          meta: { page: input.page, pageSize: 20, total: total?.value ?? 0 },
        });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  update(
    actor: Identity,
    input: RankingSettingsWrite,
    expected: number,
    key: string,
    requestId: string,
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const row = await this.row(tx, true);
        const operation = 'content.ranking-settings.update';
        const command = { input, expected };
        if (await idempotentResult(tx, actor, operation, key, command))
          return this.response(tx, row);
        if (row.revision !== expected)
          throw new BusinessError('REVISION_CONFLICT', '排行与运营设置已变化，请核对最新修订');
        const before = this.value(row);
        if (JSON.stringify(before) === JSON.stringify(input.data))
          throw new BusinessError('CONFLICT', '排行与运营设置没有变化，请核对当前内容');
        const [updated] = await tx
          .update(siteSettings)
          .set({
            value: input.data,
            revision: sql`${siteSettings.revision}+1`,
            updatedAt: new Date(),
          })
          .where(eq(siteSettings.key, 'rankings'))
          .returning();
        if (!updated) throw new Error('RANKING_SETTINGS_UPDATE_FAILED');
        const generationId = await enqueueConfiguredRankingRefreshInTransaction(tx, 'manual');
        if (!generationId) throw new Error('RANKING_REFRESH_REQUEST_FAILED');
        const [record] = await tx
          .insert(siteSettingRecords)
          .values({
            key: 'rankings',
            actorId: actor.account.id,
            reason: input.reason,
            beforeValue: before,
            afterValue: input.data,
            fromRevision: row.revision,
            toRevision: updated.revision,
            requestId,
          })
          .returning({ id: siteSettingRecords.id });
        if (!record) throw new Error('RANKING_SETTINGS_RECORD_INSERT_FAILED');
        await tx.insert(authAuditEvents).values({
          userId: actor.account.id,
          event: 'admin.ranking_settings_updated',
          requestId,
        });
        await rememberResult(tx, actor, operation, key, command, record.id);
        return this.response(tx, updated);
      },
      { area: 'content', serializeWrites: true },
    );
  }
}
