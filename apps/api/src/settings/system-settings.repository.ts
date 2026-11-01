import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import {
  authAuditEvents,
  siteSettings,
  siteSettingRecords,
  userMfa,
  users,
  type Database,
} from '@personamarket/database';
import {
  SystemSettingsResponseSchema,
  SystemSettingsRecordsResponseSchema,
  defaultSystemSettings,
  type SystemSettingsWrite,
  type SystemSettingsRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError, SystemConfigurationUnavailableError } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import { requireRecentVerification } from '../auth/verification-policy.js';
import type { Identity } from '../auth/auth.service.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';

const operation = 'admin.system-settings.update';
const signature = (input: SystemSettingsWrite, expected: number) => ({ input, expected });
@Injectable()
export class SystemSettingsRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private async row(tx: Transaction, lock = false) {
    const query = tx.select().from(siteSettings).where(eq(siteSettings.key, 'system')).limit(1);
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw new SystemConfigurationUnavailableError();
    return row;
  }
  private response(row: typeof siteSettings.$inferSelect) {
    const value = SystemSettingsResponseSchema.safeParse({
      data: row.value,
      defaults: defaultSystemSettings,
      meta: { revision: row.revision },
    });
    if (!value.success) throw new SystemConfigurationUnavailableError(value.error);
    return value.data;
  }
  authorize(actor: Identity) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
      },
      { area: 'users' },
    );
  }
  read(actor: Identity) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        return this.response(await this.row(tx));
      },
      { area: 'users', isolationLevel: 'repeatable read' },
    );
  }
  replay(actor: Identity, input: SystemSettingsWrite, expected: number, key: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const prior = await idempotentResult(tx, actor, operation, key, signature(input, expected));
        return prior ? this.response(await this.row(tx)) : undefined;
      },
      { area: 'users' },
    );
  }
  records(actor: Identity, input: SystemSettingsRecordsQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const condition = eq(siteSettingRecords.key, 'system');
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
        if (!total) throw new BusinessError('INVALID_RESPONSE', '维护设置历史暂时不可用');
        const parsed = SystemSettingsRecordsResponseSchema.safeParse({
          data: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
          meta: { page: input.page, pageSize: 20, total: total.value },
        });
        if (!parsed.success)
          throw new BusinessError('INVALID_RESPONSE', '维护设置历史暂时不可用', {
            cause: parsed.error,
          });
        return parsed.data;
      },
      { area: 'users', isolationLevel: 'repeatable read' },
    );
  }
  update(
    actor: Identity,
    input: SystemSettingsWrite,
    expected: number,
    key: string,
    requestId: string,
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const locked = await lockIdentity(tx, actor, true, false);
        if (await idempotentResult(tx, actor, operation, key, signature(input, expected)))
          return this.response(await this.row(tx));
        const [mfa] = await tx
          .select({ confirmedAt: userMfa.confirmedAt })
          .from(userMfa)
          .where(eq(userMfa.userId, locked.account.id));
        requireRecentVerification({ ...locked, mfaEnrolled: Boolean(mfa?.confirmedAt) }, true);
        const current = await this.row(tx, true);
        if (current.revision !== expected)
          throw new BusinessError('REVISION_CONFLICT', '维护设置已变化，请保留输入并核对最新修订');
        const before = this.response(current).data;
        const [updated] = await tx
          .update(siteSettings)
          .set({
            value: input.data,
            revision: sql`${siteSettings.revision}+1`,
            updatedAt: new Date(),
          })
          .where(and(eq(siteSettings.key, 'system'), eq(siteSettings.revision, expected)))
          .returning();
        if (!updated) throw new BusinessError('REVISION_CONFLICT', '维护设置已变化，请重新核对');
        const [record] = await tx
          .insert(siteSettingRecords)
          .values({
            key: 'system',
            actorId: locked.account.id,
            reason: input.reason,
            beforeValue: before,
            afterValue: input.data,
            fromRevision: current.revision,
            toRevision: updated.revision,
            requestId,
          })
          .returning({ id: siteSettingRecords.id });
        if (!record) throw new Error('SYSTEM_SETTINGS_RECORD_INSERT_FAILED');
        await tx
          .insert(authAuditEvents)
          .values({ userId: locked.account.id, event: 'admin.system_updated', requestId });
        await rememberResult(tx, actor, operation, key, signature(input, expected), record.id);
        return this.response(updated);
      },
      { area: 'users', serializeWrites: true },
    );
  }
}
