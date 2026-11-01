import { and, eq } from 'drizzle-orm';
import {
  reports,
  users,
  personas,
  personaReleases,
  comments,
  userProfiles,
} from '@personamarket/database';
import {
  ReportSnapshotSchema,
  ReportSummarySchema,
  OwnReportResponseSchema,
  AdminReportResponseSchema,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';
import { reportPublicPath, reportSnapshotHash } from './report-target.js';
export type ReportRow = typeof reports.$inferSelect;
export function reportSnapshot(row: ReportRow) {
  const parsed = ReportSnapshotSchema.safeParse(row.snapshot);
  if (!parsed.success)
    throw new BusinessError('INVALID_RESPONSE', '举报证据暂时无法读取', { cause: parsed.error });
  if (reportSnapshotHash(parsed.data) !== row.contentHash)
    throw new BusinessError('INVALID_RESPONSE', '举报证据校验失败，请联系管理员');
  return parsed.data;
}
export function reportSummary(row: ReportRow) {
  const snapshot = reportSnapshot(row);
  return ReportSummarySchema.parse({
    id: row.id,
    type: row.type,
    personaId: row.personaId,
    personaTitle: snapshot.title,
    platform: snapshot.type === 'profile' ? null : snapshot.platform,
    version: snapshot.type === 'profile' ? null : snapshot.version,
    reason: row.reason,
    status: row.status,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
export async function requireReport(tx: Transaction, id: string, reporterId?: string) {
  const [row] = await tx
    .select()
    .from(reports)
    .where(and(eq(reports.id, id), reporterId ? eq(reports.reporterId, reporterId) : undefined))
    .limit(1);
  if (!row) throw new BusinessError('NOT_FOUND', '举报记录不存在或不可访问');
  return row;
}
async function detail(tx: Transaction, row: ReportRow) {
  const snapshot = reportSnapshot(row);
  return {
    ...reportSummary(row),
    details: row.details,
    snapshot,
    publicPath: await reportPublicPath(tx, snapshot),
  };
}
export async function ownReportView(tx: Transaction, id: string, reporterId: string) {
  return OwnReportResponseSchema.parse({
    data: await detail(tx, await requireReport(tx, id, reporterId)),
  });
}
export async function adminReportView(tx: Transaction, id: string) {
  const row = await requireReport(tx, id);
  const [reporter] = await tx
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, row.reporterId));
  if (!reporter) throw new BusinessError('INVALID_RESPONSE', '举报账号暂时无法读取');
  if (row.type === 'profile') {
    if (!row.profileUserId) throw new BusinessError('INVALID_RESPONSE', '举报资料引用缺失');
    const [moderation] = await tx
      .select({
        profile: {
          revision: userProfiles.revision,
          visibility: userProfiles.visibility,
          publishedSubmissionId: userProfiles.publishedSubmissionId,
        },
        account: {
          id: users.id,
          role: users.role,
          status: users.status,
          securityVersion: users.securityVersion,
        },
      })
      .from(userProfiles)
      .innerJoin(users, eq(users.id, userProfiles.userId))
      .where(eq(userProfiles.userId, row.profileUserId));
    if (!moderation) throw new BusinessError('INVALID_RESPONSE', '举报资料状态暂时无法读取');
    return AdminReportResponseSchema.parse({
      data: {
        ...(await detail(tx, row)),
        reporter,
        moderation: { ...moderation, persona: null, release: null, comment: null },
      },
    });
  }
  if (!row.personaId || !row.releaseId)
    throw new BusinessError('INVALID_RESPONSE', '举报作品引用缺失');
  const [moderation] = await tx
    .select({
      persona: { revision: personas.revision, state: personas.moderationState },
      release: { revision: personaReleases.moderationRevision, state: personaReleases.lifecycle },
      comment: { revision: comments.revision, visibility: comments.visibility },
      account: {
        id: users.id,
        role: users.role,
        status: users.status,
        securityVersion: users.securityVersion,
      },
    })
    .from(personas)
    .innerJoin(
      personaReleases,
      and(eq(personaReleases.id, row.releaseId), eq(personaReleases.personaId, personas.id)),
    )
    .innerJoin(users, eq(users.id, row.reportedUserId))
    .leftJoin(
      comments,
      and(
        eq(comments.id, row.commentId ?? '00000000-0000-0000-0000-000000000000'),
        eq(comments.personaId, personas.id),
      ),
    )
    .where(eq(personas.id, row.personaId));
  if (!moderation) throw new BusinessError('INVALID_RESPONSE', '举报目标状态暂时无法读取');
  return AdminReportResponseSchema.parse({
    data: { ...(await detail(tx, row)), reporter, moderation },
  });
}
