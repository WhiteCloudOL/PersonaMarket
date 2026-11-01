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
  AccountSettingsResponseSchema,
  AccountSettingsRecordsResponseSchema,
  AccountSettingsRecordValueSchema,
  defaultVerificationEmailTiming,
  defaultRegistrationRateLimit,
  type AccountSettingsUpdate,
  type AccountSettingsRecordsQuery,
} from '@personamarket/contracts';
import {
  BusinessError,
  accountSettings,
  accountSettingsRecord,
  accountSettingsStoredRecord,
  StoredAccountSettingsSchema,
  StoredMailSettingsSchema,
  environmentMail,
  type ServerEnvironment,
} from '@personamarket/server';
import { DATABASE, ENVIRONMENT } from '../tokens.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import { requireRecentVerification } from '../auth/verification-policy.js';
import type { Identity } from '../auth/auth.service.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';

export function normalizeAccountSettingsUpdate(input: AccountSettingsUpdate) {
  if ('data' in input) return input;
  const { reason, ...data } = input;
  return { data, reason };
}
export type AccountSettingsCommand = ReturnType<typeof normalizeAccountSettingsUpdate>;
type SettingRow = typeof siteSettings.$inferSelect;
const operation = 'admin.account-settings.update';
const signature = (input: AccountSettingsCommand, expected: number) => ({ input, expected });

@Injectable()
export class AccountSettingsRepository {
  constructor(
    @Inject(DATABASE) readonly database: Database,
    @Inject(ENVIRONMENT) readonly env: ServerEnvironment,
  ) {}
  private async row(tx: Transaction, lock = false) {
    const query = tx.select().from(siteSettings).where(eq(siteSettings.key, 'accounts')).limit(1);
    const [row] = lock ? await query.for('update') : await query;
    if (!row) throw new BusinessError('SERVICE_UNAVAILABLE', '注册与账户设置尚未完成初始化');
    return row;
  }
  private response(row: SettingRow) {
    try {
      return AccountSettingsResponseSchema.parse({
        data: accountSettings(row.value, this.env),
        defaults: {
          registrationEnabled: this.env.AUTH_REGISTRATION_ENABLED,
          sessionTtlSeconds: this.env.AUTH_SESSION_TTL_SECONDS,
          verificationEmailTiming: defaultVerificationEmailTiming,
          registrationRateLimit: { ...defaultRegistrationRateLimit },
        },
        meta: { revision: row.revision },
      });
    } catch (cause) {
      throw new BusinessError('INVALID_RESPONSE', '注册与账户设置暂时不可用', { cause });
    }
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
  replay(actor: Identity, input: AccountSettingsCommand, expected: number, key: string) {
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
  records(actor: Identity, input: AccountSettingsRecordsQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const condition = eq(siteSettingRecords.key, 'accounts');
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
        if (!total) throw new BusinessError('INVALID_RESPONSE', '账户策略历史暂时无法读取');
        const value = (raw: unknown) => {
          const current = AccountSettingsRecordValueSchema.safeParse(raw);
          if (current.success) return current.data;
          try {
            return AccountSettingsRecordValueSchema.parse({
              stored: accountSettingsStoredRecord(raw),
              effective: null,
            });
          } catch (cause) {
            throw new BusinessError('INVALID_RESPONSE', '账户策略历史暂时不可用', { cause });
          }
        };
        return AccountSettingsRecordsResponseSchema.parse({
          data: rows.map((row) => ({
            ...row,
            before: value(row.before),
            after: value(row.after),
            createdAt: row.createdAt.toISOString(),
          })),
          meta: { page: input.page, pageSize: 20, total: total.value },
        });
      },
      { area: 'users', isolationLevel: 'repeatable read' },
    );
  }
  update(
    actor: Identity,
    input: AccountSettingsCommand,
    expected: number,
    key: string | undefined,
    requestId: string,
    mailRevision: number | undefined,
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const locked = await lockIdentity(tx, actor, true, false);
        const current = await this.row(tx, true);
        if (key && (await idempotentResult(tx, actor, operation, key, signature(input, expected))))
          return this.response(current);
        const [mfa] = await tx
          .select({ confirmedAt: userMfa.confirmedAt })
          .from(userMfa)
          .where(eq(userMfa.userId, locked.account.id));
        requireRecentVerification({ ...locked, mfaEnrolled: Boolean(mfa?.confirmedAt) }, true);
        if (current.revision !== expected)
          throw new BusinessError(
            'REVISION_CONFLICT',
            '注册与账户设置已变化，请核对最新修订后重试',
          );
        // 旧flat载荷仅省略新字段。原始null/fallback不因省略新字段而重写成默认策略。
        const stored = StoredAccountSettingsSchema.parse(current.value);
        const next = StoredAccountSettingsSchema.parse({
          ...stored,
          registrationEnabled: input.data.registrationEnabled,
          sessionTtlSeconds: input.data.sessionTtlSeconds,
          ...(input.data.verificationEmailTiming === undefined
            ? {}
            : { verificationEmailTiming: input.data.verificationEmailTiming }),
          ...(input.data.registrationRateLimit === undefined
            ? {}
            : { registrationRateLimit: input.data.registrationRateLimit }),
        });
        if (next.registrationEnabled) {
          const [mail] = await tx
            .select()
            .from(siteSettings)
            .where(eq(siteSettings.key, 'mail'))
            .for('share');
          if (!mail || mailRevision === undefined || mail.revision !== mailRevision)
            throw new BusinessError('REVISION_CONFLICT', '邮件配置已变化，请重新核对账户策略');
          const configuration = StoredMailSettingsSchema.parse(mail.value);
          if (
            configuration.mode === 'disabled' ||
            (configuration.mode === 'environment' && !environmentMail(this.env))
          )
            throw new BusinessError('SERVICE_UNAVAILABLE', '邮件尚未就绪，暂时不能开放注册');
        }
        const before = accountSettingsRecord(current.value, this.env),
          after = accountSettingsRecord(next, this.env);
        const [updated] = await tx
          .update(siteSettings)
          .set({ value: next, revision: sql`${siteSettings.revision}+1`, updatedAt: new Date() })
          .where(and(eq(siteSettings.key, 'accounts'), eq(siteSettings.revision, expected)))
          .returning();
        if (!updated)
          throw new BusinessError('REVISION_CONFLICT', '账户策略已变化，请核对最新修订');
        const [record] = await tx
          .insert(siteSettingRecords)
          .values({
            key: 'accounts',
            actorId: locked.account.id,
            reason: input.reason,
            beforeValue: before,
            afterValue: after,
            fromRevision: current.revision,
            toRevision: updated.revision,
            requestId,
          })
          .returning({ id: siteSettingRecords.id });
        if (!record) throw new Error('ACCOUNT_SETTINGS_RECORD_INSERT_FAILED');
        await tx
          .insert(authAuditEvents)
          .values({ userId: locked.account.id, event: 'admin.accounts_updated', requestId });
        if (key)
          await rememberResult(tx, actor, operation, key, signature(input, expected), record.id);
        return this.response(updated);
      },
      { area: 'users', serializeWrites: true },
    );
  }
}
