import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  authAuditEvents,
  siteSettings,
  siteSettingRecords,
  users,
  type Database,
} from '@personamarket/database';
import {
  CreationSettingsSchema,
  CreationSettingsResponseSchema,
  SubmissionSettingsRecordsResponseSchema,
  SubmissionSettingsSchema,
  defaultCreationSettings,
  type CreationSettingsUpdate,
  type SubmissionSettingsRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';

const groups = ['contentLimits', 'submissions'] as const;
type Row = typeof siteSettings.$inferSelect;
const storedRecordValue = z.object(SubmissionSettingsSchema.partial({ pendingHint: true }).shape);
function recordValue(value: unknown) {
  const parsed = storedRecordValue.safeParse(value);
  if (!parsed.success)
    throw new BusinessError('INVALID_RESPONSE', '投稿策略历史暂时不可用，请联系管理员', {
      cause: parsed.error,
    });
  return { ...parsed.data, pendingHint: parsed.data.pendingHint ?? null };
}
function response(rows: readonly Row[]) {
  const limits = rows.find((row) => row.key === 'contentLimits');
  const submissions = rows.find((row) => row.key === 'submissions');
  if (!limits || !submissions)
    throw new BusinessError('SERVICE_UNAVAILABLE', '创作设置尚未完成初始化');
  const value = CreationSettingsResponseSchema.safeParse({
    data: { contentLimits: limits.value, submissions: submissions.value },
    defaults: defaultCreationSettings,
    meta: { contentLimits: limits.revision, submissions: submissions.revision },
  });
  if (!value.success)
    throw new BusinessError('INVALID_RESPONSE', '创作设置暂时不可用，请联系管理员', {
      cause: value.error,
    });
  return value.data;
}

@Injectable()
export class CreationSettingsRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private rows(tx: Transaction, lock = false) {
    const query = tx
      .select()
      .from(siteSettings)
      .where(inArray(siteSettings.key, [...groups]))
      .orderBy(siteSettings.key);
    return lock ? query.for('update') : query;
  }
  read(actor: Identity) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        return response(await this.rows(tx));
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  records(actor: Identity, input: SubmissionSettingsRecordsQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const condition = eq(siteSettingRecords.key, 'submissions');
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
        if (!total) throw new BusinessError('INVALID_RESPONSE', '投稿策略记录暂时无法读取');
        return SubmissionSettingsRecordsResponseSchema.parse({
          data: rows.map((row) => ({
            ...row,
            before: recordValue(row.before),
            after: recordValue(row.after),
            createdAt: row.createdAt.toISOString(),
          })),
          meta: { page: input.page, pageSize: 20, total: total.value },
        });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  update(
    actor: Identity,
    input: CreationSettingsUpdate,
    key: string | undefined,
    requestId: string,
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const rows = await this.rows(tx, true);
        const before = response(rows);
        const operation = 'content.creation-settings.update';
        if (key && (await idempotentResult(tx, actor, operation, key, input))) return before;
        for (const group of groups)
          if (before.meta[group] !== input.expected[group])
            throw new BusinessError('REVISION_CONFLICT', '创作设置已被更新，请核对最新修订');
        const data = CreationSettingsSchema.parse({
          ...input.data,
          submissions: {
            ...input.data.submissions,
            pendingHint: input.data.submissions.pendingHint ?? before.data.submissions.pendingHint,
          },
        });
        const updatedRows: Row[] = [];
        let receiptId: string | undefined;
        // 保留既有双修订保存语义，正文上限和投稿策略仍在同一事务内提交。
        for (const group of groups) {
          const [updated] = await tx
            .update(siteSettings)
            .set({
              value: data[group],
              revision: sql`${siteSettings.revision}+1`,
              updatedAt: new Date(),
            })
            .where(
              and(eq(siteSettings.key, group), eq(siteSettings.revision, input.expected[group])),
            )
            .returning();
          if (!updated)
            throw new BusinessError('REVISION_CONFLICT', '创作设置已被更新，请核对最新修订');
          updatedRows.push(updated);
          const [record] = await tx
            .insert(siteSettingRecords)
            .values({
              key: group,
              actorId: actor.account.id,
              reason: input.reason,
              beforeValue: before.data[group],
              afterValue: data[group],
              fromRevision: before.meta[group],
              toRevision: updated.revision,
              requestId,
            })
            .returning({ id: siteSettingRecords.id });
          if (!record) throw new Error('CREATION_SETTINGS_RECORD_INSERT_FAILED');
          receiptId ??= record.id;
        }
        await tx.insert(authAuditEvents).values({
          userId: actor.account.id,
          requestId,
          event: 'admin.creation_settings_updated',
        });
        if (key) {
          if (!receiptId) throw new Error('CREATION_SETTINGS_RECEIPT_MISSING');
          await rememberResult(tx, actor, operation, key, input, receiptId);
        }
        return response(updatedRows);
      },
      { area: 'content', serializeWrites: true },
    );
  }
}
