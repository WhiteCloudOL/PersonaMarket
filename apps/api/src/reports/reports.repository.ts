import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import {
  reports,
  reportActions,
  reportResolutions,
  users,
  userMfa,
  assets,
  authAuditEvents,
  type Database,
} from '@personamarket/database';
import {
  OwnReportsResponseSchema,
  AdminReportsResponseSchema,
  OwnReportRecordsResponseSchema,
  AdminReportRecordsResponseSchema,
  reportNextStatus,
  ReportResolutionSchema,
  ReportResolutionResultSchema,
  type CreateReport,
  type OwnReportsQuery,
  type AdminReportsQuery,
  type ReportRecordsQuery,
  type AdminReportAction,
} from '@personamarket/contracts';
import {
  BusinessError,
  enqueueNotification,
  assertOrdinaryWriteAllowed,
} from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import { requireRecentVerification } from '../auth/verification-policy.js';
import type { Identity } from '../auth/auth.service.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';
import { captureReportTarget } from './report-target.js';
import { applyReportResolution, lockReportParticipants } from './report-resolutions.js';
import {
  reportSummary,
  requireReport,
  ownReportView,
  adminReportView,
  reportSnapshot,
  type ReportRow,
} from './report-views.js';

async function selfReview(
  tx: Transaction,
  identity: Awaited<ReturnType<typeof lockIdentity>>,
  row: ReportRow,
  input: AdminReportAction,
) {
  const self = row.reporterId === identity.account.id || row.reportedUserId === identity.account.id;
  if (!self) return false;
  if (!input.selfReviewConfirmed)
    throw new BusinessError('FORBIDDEN', '处理涉及自己的举报需要明确确认和近期身份验证');
  const [mfa] = await tx
    .select({ confirmedAt: userMfa.confirmedAt })
    .from(userMfa)
    .where(eq(userMfa.userId, identity.account.id));
  requireRecentVerification({ ...identity, mfaEnrolled: Boolean(mfa?.confirmedAt) }, true);
  return true;
}
async function dailyLimit(tx: Transaction, reporterId: string) {
  const result = await tx.execute<{
    amount: number;
    retry: number;
  }>(sql`SELECT count(*)::integer AS amount,
    GREATEST(1,ceil(extract(epoch FROM (((date_trunc('day',now() AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC')-now()))))::integer AS retry
    FROM reports WHERE reporter_id=${reporterId} AND created_at>=(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`);
  const quota = result.rows[0];
  if (quota && quota.amount >= 20)
    throw new BusinessError('RATE_LIMITED', '今日举报次数已达上限，请在明天继续', {
      retryAfterSeconds: quota.retry,
    });
}
function duplicate(cause: unknown): never {
  let current = cause;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (
      'code' in current &&
      current.code === '23505' &&
      'constraint' in current &&
      current.constraint === 'reports_active_actor_target_unique'
    )
      throw new BusinessError('CONFLICT', '这份公开内容已有待处理举报，可在我的举报查看', {
        cause,
      });
    current = current.cause;
  }
  throw cause;
}
@Injectable()
export class ReportsRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private read<T>(actor: Identity, admin: boolean, operation: (tx: Transaction) => Promise<T>) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, admin, false);
        return operation(tx);
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  own(actor: Identity, id: string) {
    return this.read(actor, false, (tx) => ownReportView(tx, id, actor.account.id));
  }
  admin(actor: Identity, id: string) {
    return this.read(actor, true, (tx) => adminReportView(tx, id));
  }
  avatar(actor: Identity, id: string, admin: boolean) {
    return this.read(actor, admin, async (tx) => {
      const row = await requireReport(tx, id, admin ? undefined : actor.account.id);
      const snapshot = reportSnapshot(row);
      if (snapshot.type !== 'profile' || !snapshot.profile.content.avatarAssetId)
        throw new BusinessError('NOT_FOUND', '这份举报没有头像证据');
      const [asset] = await tx
        .select({ storageKey: assets.storageKey })
        .from(assets)
        .where(
          and(
            eq(assets.id, snapshot.profile.content.avatarAssetId),
            eq(assets.ownerId, snapshot.profile.userId),
            eq(assets.purpose, 'avatar'),
          ),
        );
      if (!asset) throw new BusinessError('NOT_FOUND', '头像证据不存在或不可访问');
      return asset.storageKey;
    });
  }
  ownList(actor: Identity, input: OwnReportsQuery) {
    return this.read(actor, false, async (tx) => {
      const where = and(
        eq(reports.reporterId, actor.account.id),
        input.status === 'all' ? undefined : eq(reports.status, input.status),
      );
      const rows = await tx
        .select()
        .from(reports)
        .where(where)
        .orderBy(desc(reports.createdAt), desc(reports.id))
        .limit(20)
        .offset((input.page - 1) * 20);
      const [total] = await tx.select({ value: count() }).from(reports).where(where);
      return OwnReportsResponseSchema.parse({
        data: rows.map(reportSummary),
        meta: { page: input.page, pageSize: 20, total: total?.value ?? 0 },
      });
    });
  }
  adminList(actor: Identity, input: AdminReportsQuery) {
    return this.read(actor, true, async (tx) => {
      const conditions: SQL[] = [];
      if (input.status !== 'all') conditions.push(eq(reports.status, input.status));
      if (input.type !== 'all') conditions.push(eq(reports.type, input.type));
      if (input.id) conditions.push(eq(reports.id, input.id));
      const where = and(...conditions);
      const rows = await tx
        .select({ entry: reports, reporter: { id: users.id, username: users.username } })
        .from(reports)
        .innerJoin(users, eq(users.id, reports.reporterId))
        .where(where)
        .orderBy(desc(reports.createdAt), desc(reports.id))
        .limit(20)
        .offset((input.page - 1) * 20);
      const [total] = await tx.select({ value: count() }).from(reports).where(where);
      return AdminReportsResponseSchema.parse({
        data: rows.map((row) => ({ ...reportSummary(row.entry), reporter: row.reporter })),
        meta: { page: input.page, pageSize: 20, total: total?.value ?? 0 },
      });
    });
  }
  records(actor: Identity, id: string, input: ReportRecordsQuery, admin: boolean) {
    return this.read(actor, admin, async (tx) => {
      await requireReport(tx, id, admin ? undefined : actor.account.id);
      const condition = and(
        eq(reportActions.reportId, id),
        admin
          ? undefined
          : or(sql`${reportActions.action}<>'noted'`, sql`${reportActions.message}<>''`),
      );
      const rows = await tx
        .select({ entry: reportActions, username: users.username, resolution: reportResolutions })
        .from(reportActions)
        .innerJoin(users, eq(users.id, reportActions.actorId))
        .leftJoin(reportResolutions, eq(reportResolutions.actionId, reportActions.id))
        .where(condition)
        .orderBy(desc(reportActions.toRevision))
        .limit(20)
        .offset((input.page - 1) * 20);
      const [total] = await tx.select({ value: count() }).from(reportActions).where(condition);
      const meta = { page: input.page, pageSize: 20, total: total?.value ?? 0 };
      const common = rows.map(({ entry, username, resolution }) => ({
        entry,
        username,
        resolutionDetail: resolution
          ? {
              command: ReportResolutionSchema.parse(resolution.command),
              result: ReportResolutionResultSchema.parse(resolution.result),
            }
          : null,
        public: {
          id: entry.id,
          action: entry.action,
          message: entry.message,
          beforeStatus: entry.beforeStatus,
          afterStatus: entry.afterStatus,
          fromRevision: entry.fromRevision,
          toRevision: entry.toRevision,
          createdAt: entry.createdAt.toISOString(),
          resolution: resolution
            ? {
                content: ReportResolutionSchema.parse(resolution.command).content?.action ?? null,
                account: ReportResolutionSchema.parse(resolution.command).account?.action ?? null,
              }
            : null,
        },
      }));
      return admin
        ? AdminReportRecordsResponseSchema.parse({
            data: common.map((row) => ({
              ...row.public,
              actor: { id: row.entry.actorId, username: row.username },
              privateNote: row.entry.privateNote,
              selfReview: row.entry.selfReview,
              resolutionDetail: row.resolutionDetail,
            })),
            meta,
          })
        : OwnReportRecordsResponseSchema.parse({
            data: common.map((row) => ({
              ...row.public,
              actor: row.entry.action === 'submitted' ? 'you' : 'administrator',
            })),
            meta,
          });
    });
  }
  create(actor: Identity, input: CreateReport, key: string, requestId: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, false, false);
        const operation = 'report.create';
        const retry = await idempotentResult(tx, actor, operation, key, input);
        if (retry) return ownReportView(tx, retry, actor.account.id);
        await assertOrdinaryWriteAllowed(tx);
        await dailyLimit(tx, actor.account.id);
        const target = await captureReportTarget(tx, input.target);
        const [recent] = await tx
          .select({ id: reports.id })
          .from(reports)
          .where(
            and(
              eq(reports.reporterId, actor.account.id),
              eq(reports.type, target.type),
              eq(reports.targetId, target.targetId),
              eq(reports.targetRevisionId, target.targetRevisionId),
              or(
                sql`${reports.status} IN ('pending','processing')`,
                sql`${reports.createdAt}>now()-interval '24 hours'`,
              ),
            ),
          )
          .limit(1);
        if (recent)
          throw new BusinessError('CONFLICT', '这份公开内容已提交举报，可在我的举报跟进处理');
        const [row] = await tx
          .insert(reports)
          .values({
            ...target,
            reporterId: actor.account.id,
            updatedBy: actor.account.id,
            reason: input.reason,
            details: input.details,
          })
          .returning({ id: reports.id });
        if (!row) throw new Error('REPORT_INSERT_FAILED');
        await tx.insert(reportActions).values({
          reportId: row.id,
          actorId: actor.account.id,
          action: 'submitted',
          beforeStatus: null,
          afterStatus: 'pending',
          fromRevision: 0,
          toRevision: 1,
          requestId,
        });
        await tx
          .insert(authAuditEvents)
          .values({ userId: actor.account.id, event: 'report.submitted', requestId });
        await rememberResult(tx, actor, operation, key, input, row.id);
        return ownReportView(tx, row.id, actor.account.id);
      },
      { area: 'content' },
    ).catch(duplicate);
  }
  act(
    actor: Identity,
    id: string,
    expected: number,
    input: AdminReportAction,
    key: string,
    requestId: string,
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const identity = await lockIdentity(tx, actor, true, Boolean(input.resolution));
        const [row] = await tx.select().from(reports).where(eq(reports.id, id)).for('update');
        if (!row) throw new BusinessError('NOT_FOUND', '举报记录不存在或不可访问');
        const self = await selfReview(tx, identity, row, input);
        const operation = 'report.manage',
          command = { id, expected, input };
        if (await idempotentResult(tx, actor, operation, key, command))
          return adminReportView(tx, id);
        if (row.revision !== expected)
          throw new BusinessError('REVISION_CONFLICT', '举报处理状态已变化，请核对最新修订');
        const next = reportNextStatus(row.status, input.action);
        if (!next) throw new BusinessError('CONFLICT', '当前举报状态不支持此操作，请核对最新记录');
        await lockReportParticipants(tx, row);
        const resolution = input.resolution
          ? await applyReportResolution(tx, actor, row, input.resolution, requestId)
          : null;
        await tx
          .update(reports)
          .set({
            status: next,
            revision: sql`${reports.revision}+1`,
            updatedBy: actor.account.id,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(reports.id, id));
        const actions = {
          accept: 'accepted',
          resolve: 'resolved',
          dismiss: 'dismissed',
          note: 'noted',
        } as const;
        // 空白的可选说明表示仅记录内部备注，真实文字的空白和换行保持原样
        const message = input.message.trim() ? input.message : '';
        const [record] = await tx
          .insert(reportActions)
          .values({
            reportId: id,
            actorId: actor.account.id,
            action: actions[input.action],
            message,
            privateNote: input.privateNote,
            beforeStatus: row.status,
            afterStatus: next,
            fromRevision: row.revision,
            toRevision: row.revision + 1,
            selfReview: self,
            requestId,
          })
          .returning({ id: reportActions.id });
        if (!record) throw new Error('REPORT_ACTION_INSERT_FAILED');
        if (resolution)
          await tx.insert(reportResolutions).values({
            actionId: record.id,
            command: input.resolution,
            result: resolution,
          });
        if (message)
          await enqueueNotification(tx, {
            recipientId: row.reporterId,
            actorId: actor.account.id,
            sourceId: record.id,
            kind: 'report_updated',
            title: '举报处理有新进展',
            message,
            target: { type: 'own_report', reportId: row.id },
          });
        await tx.insert(authAuditEvents).values({
          userId: actor.account.id,
          event: 'admin.report_' + actions[input.action],
          requestId,
        });
        await rememberResult(tx, actor, operation, key, command, record.id);
        return adminReportView(tx, id);
      },
      { area: 'content', serializeWrites: true },
    );
  }
}
