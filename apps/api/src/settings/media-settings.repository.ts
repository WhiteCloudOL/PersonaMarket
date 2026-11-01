import { Inject, Injectable } from '@nestjs/common';
import { count, desc, eq, sql } from 'drizzle-orm';
import {
  siteSettings,
  siteSettingRecords,
  users,
  authAuditEvents,
  type Database,
} from '@personamarket/database';
import {
  MediaSettingsSchema,
  MediaSettingsResponseSchema,
  MediaSettingsRecordsResponseSchema,
  PublicMediaSettingsResponseSchema,
  defaultMediaSettings,
  type MediaSettingsWrite,
  type MediaSettingsRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';

type Row = typeof siteSettings.$inferSelect;
@Injectable()
export class MediaSettingsRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private async row(tx: Transaction, lock = false) {
    const query = tx.select().from(siteSettings).where(eq(siteSettings.key, 'media'));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new BusinessError('SERVICE_UNAVAILABLE', '文件与图片设置尚未完成初始化');
    return row;
  }
  private value(row: Row) {
    const parsed = MediaSettingsSchema.safeParse(row.value);
    if (!parsed.success)
      throw new BusinessError('INVALID_RESPONSE', '文件与图片设置暂时不可用，请联系管理员', {
        cause: parsed.error,
      });
    return parsed.data;
  }
  private async response(tx: Transaction, row: Row) {
    const [last] = await tx
      .select({ actor: users.username })
      .from(siteSettingRecords)
      .innerJoin(users, eq(users.id, siteSettingRecords.actorId))
      .where(eq(siteSettingRecords.key, 'media'))
      .orderBy(desc(siteSettingRecords.toRevision))
      .limit(1);
    return MediaSettingsResponseSchema.parse({
      data: this.value(row),
      defaults: defaultMediaSettings,
      meta: {
        revision: row.revision,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: last?.actor ?? null,
      },
    });
  }
  async publicRead() {
    try {
      return await this.database.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout='2s'`);
        const row = await this.row(tx);
        return PublicMediaSettingsResponseSchema.parse({
          data: this.value(row),
          meta: { revision: row.revision },
        });
      });
    } catch (cause) {
      if (cause instanceof BusinessError) throw cause;
      throw new BusinessError('SERVICE_UNAVAILABLE', '文件与图片设置暂时无法读取，请稍后重试', {
        cause,
        retryAfterSeconds: 1,
      });
    }
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
  records(actor: Identity, input: MediaSettingsRecordsQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const condition = eq(siteSettingRecords.key, 'media');
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
        return MediaSettingsRecordsResponseSchema.parse({
          data: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
          meta: { page: input.page, pageSize: 20, total: total?.value ?? 0 },
        });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  update(
    actor: Identity,
    input: MediaSettingsWrite,
    expected: number,
    key: string,
    requestId: string,
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const row = await this.row(tx, true);
        const operation = 'content.media-settings.update';
        const command = { input, expected };
        if (await idempotentResult(tx, actor, operation, key, command))
          return this.response(tx, row);
        if (row.revision !== expected)
          throw new BusinessError('REVISION_CONFLICT', '文件与图片设置已变化，请核对最新修订');
        const before = this.value(row);
        if (JSON.stringify(before) === JSON.stringify(input.data))
          throw new BusinessError('CONFLICT', '文件与图片设置没有变化，请核对当前内容');
        const [updated] = await tx
          .update(siteSettings)
          .set({
            value: input.data,
            revision: sql`${siteSettings.revision}+1`,
            updatedAt: new Date(),
          })
          .where(eq(siteSettings.key, 'media'))
          .returning();
        if (!updated) throw new Error('TRANSFER_SETTINGS_UPDATE_FAILED');
        const [record] = await tx
          .insert(siteSettingRecords)
          .values({
            key: 'media',
            actorId: actor.account.id,
            reason: input.reason,
            beforeValue: before,
            afterValue: input.data,
            fromRevision: row.revision,
            toRevision: updated.revision,
            requestId,
          })
          .returning({ id: siteSettingRecords.id });
        if (!record) throw new Error('TRANSFER_SETTINGS_RECORD_INSERT_FAILED');
        await tx.insert(authAuditEvents).values({
          userId: actor.account.id,
          event: 'admin.media_settings_updated',
          requestId,
        });
        await rememberResult(tx, actor, operation, key, command, record.id);
        return this.response(tx, updated);
      },
      { area: 'content', serializeWrites: true },
    );
  }
}
