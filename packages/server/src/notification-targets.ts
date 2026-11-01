import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  personas,
  personaReleases,
  releaseSubmissions,
  reports,
  userProfiles,
  type Database,
} from '@personamarket/database';
import { NotificationTargetSchema, type NotificationTarget } from '@personamarket/contracts';
import { publicCurrentCondition } from './public-visibility.js';

type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
export type NotificationDestination = { available: boolean; path: string | null };
const unavailable: NotificationDestination = { available: false, path: null };
export function notificationTargetKey(target: NotificationTarget) {
  return JSON.stringify(NotificationTargetSchema.parse(target));
}
function publicPersona(id: SQL) {
  return sql`EXISTS(SELECT 1 FROM ${personas}
    JOIN ${personaReleases} ON ${personaReleases.personaId}=${personas.id}
    JOIN ${releaseSubmissions} ON ${releaseSubmissions.id}=${personaReleases.approvedSubmissionId}
      AND ${releaseSubmissions.personaId}=${personas.id} AND ${releaseSubmissions.releaseId}=${personaReleases.id}
    WHERE ${personas.id}=${id} AND ${publicCurrentCondition})`;
}
const idsSql = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
const ownLocation = z.object({
  id: z.uuid(),
  personaId: z.uuid(),
  position: z.coerce.number().int().positive(),
});
const replyLocation = ownLocation.extend({
  rootId: z.uuid(),
  rootPosition: z.coerce.number().int().positive(),
});

/** 按目标类型批量读取，列表最多五组SQL；不为每张通知卡片逐条查询 */
export async function resolveNotificationTargets(
  tx: Transaction,
  recipientId: string,
  targets: NotificationTarget[],
  options: { paths?: boolean } = {},
) {
  const paths = options.paths !== false;
  const unique = [
    ...new Map(targets.map((target) => [notificationTargetKey(target), target])).values(),
  ];
  const destinations = new Map<string, NotificationDestination>(
    unique.map((target) => [notificationTargetKey(target), unavailable]),
  );
  const set = (target: NotificationTarget, path: string | null) =>
    destinations.set(notificationTargetKey(target), { available: true, path: paths ? path : null });
  for (const target of unique)
    if (target.type === 'account') set(target, '/account');
    else if (target.type === 'none') set(target, null);
  const ownProfiles = unique.filter((target) => target.type === 'own_profile');
  if (ownProfiles.length) {
    const [profile] = await tx
      .select({ id: userProfiles.userId })
      .from(userProfiles)
      .where(eq(userProfiles.userId, recipientId));
    if (profile) for (const target of ownProfiles) set(target, '/dashboard/profile');
  }
  const ownPersonas = unique.filter((target) => target.type === 'own_persona');
  if (ownPersonas.length) {
    const rows = await tx
      .select({ id: personas.id })
      .from(personas)
      .where(
        and(
          eq(personas.ownerId, recipientId),
          inArray(
            personas.id,
            ownPersonas.map((target) => target.personaId),
          ),
        ),
      );
    const allowed = new Set(rows.map((row) => row.id));
    for (const target of ownPersonas)
      if (allowed.has(target.personaId))
        set(target, '/dashboard/personas/' + target.personaId + '/releases');
  }
  const ownReports = unique.filter((target) => target.type === 'own_report');
  if (ownReports.length) {
    const rows = await tx
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.reporterId, recipientId),
          inArray(
            reports.id,
            ownReports.map((target) => target.reportId),
          ),
        ),
      );
    const allowed = new Set(rows.map((row) => row.id));
    for (const target of ownReports)
      if (allowed.has(target.reportId)) set(target, '/dashboard/reports?report=' + target.reportId);
  }
  const ownComments = unique.filter((target) => target.type === 'own_comment');
  if (ownComments.length) {
    const rows =
      await tx.execute(sql`SELECT c.id,c.persona_id AS "personaId",${paths ? sql`(SELECT count(*)::integer FROM comments owned WHERE owned.persona_id=c.persona_id AND owned.author_id=${recipientId} AND owned.visibility<>'deleted' AND (owned.created_at,owned.id)>=(c.created_at,c.id))` : sql`1`} AS position
      FROM comments c WHERE c.id IN (${idsSql(ownComments.map((target) => target.commentId))}) AND c.author_id=${recipientId} AND c.visibility<>'deleted' AND ${publicPersona(sql`c.persona_id`)}`);
    const locations = new Map(
      z
        .array(ownLocation)
        .parse(rows.rows)
        .map((row) => [row.id, row]),
    );
    for (const target of ownComments) {
      const row = locations.get(target.commentId);
      if (!row || row.personaId !== target.personaId) continue;
      const page = Math.ceil(row.position / 5);
      if (page > 2500) continue;
      set(target, '/personas/' + row.personaId + '?myCommentsPage=' + page + '#my-comments');
    }
  }
  const replies = unique.filter((target) => target.type === 'public_comment');
  if (replies.length) {
    const rows = await tx.execute(sql`SELECT c.id,c.persona_id AS "personaId",root.id AS "rootId",
      ${paths ? sql`(SELECT count(*)::integer FROM comments sibling WHERE sibling.parent_id=root.id AND sibling.first_published_at IS NOT NULL AND (sibling.created_at,sibling.id)<=(c.created_at,c.id))` : sql`1`} AS position,
      ${paths ? sql`(SELECT count(*)::integer FROM comments floor WHERE floor.persona_id=c.persona_id AND floor.parent_id IS NULL AND floor.first_published_at IS NOT NULL AND (floor.created_at,floor.id)<=(root.created_at,root.id))` : sql`1`} AS "rootPosition"
      FROM comments c JOIN comments root ON root.id=c.parent_id AND root.persona_id=c.persona_id AND root.first_published_at IS NOT NULL
      JOIN comments addressed ON addressed.id=COALESCE(c.reply_to_id,c.parent_id) AND addressed.persona_id=c.persona_id
      JOIN comment_revisions approved ON approved.comment_id=c.id AND approved.id=c.public_revision_id AND approved.status='APPROVED'
      JOIN users author ON author.id=c.author_id AND author.status='active' AND author.email_verified_at IS NOT NULL
      WHERE c.id IN (${idsSql(replies.map((target) => target.commentId))}) AND c.visibility='normal' AND c.first_published_at IS NOT NULL
        AND EXISTS(SELECT 1 FROM site_settings WHERE key='community' AND value->>'showExistingComments'='true')
        AND addressed.author_id=${recipientId} AND c.author_id<>${recipientId} AND ${publicPersona(sql`c.persona_id`)}`);
    const locations = new Map(
      z
        .array(replyLocation)
        .parse(rows.rows)
        .map((row) => [row.id, row]),
    );
    for (const target of replies) {
      const row = locations.get(target.commentId);
      if (!row || row.personaId !== target.personaId) continue;
      const page = Math.ceil(row.rootPosition / 20),
        replyPage = Math.ceil(row.position / 20);
      if (page > 2500 || replyPage > 2500) continue;
      set(
        target,
        '/personas/' +
          row.personaId +
          '?commentsPage=' +
          page +
          '&commentsSort=oldest&replyThread=' +
          row.rootId +
          '&repliesPage=' +
          replyPage +
          '#comment-' +
          row.id,
      );
    }
  }
  return destinations;
}
