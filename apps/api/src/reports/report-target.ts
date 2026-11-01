import { createHash } from 'node:crypto';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import {
  comments,
  commentRevisions,
  personas,
  personaReleases,
  releaseSubmissions,
  users,
} from '@personamarket/database';
import {
  ReportSnapshotSchema,
  PersonaReportSnapshotSchema,
  CommentReportSnapshotSchema,
  PublicCardSnapshotSchema,
  type CreateReport,
  type ReportSnapshot,
} from '@personamarket/contracts';
import {
  BusinessError,
  publicCurrentCondition,
  publicReleaseCondition,
} from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';
import { publicProfileReportSnapshot } from './profile-report-target.js';

const metadataSchema = PublicCardSnapshotSchema.pick({
  title: true,
  summary: true,
  platform: true,
});
const unavailable = () => new BusinessError('NOT_FOUND', '举报目标不存在或暂不可公开');
export function reportSnapshotHash(snapshot: ReportSnapshot) {
  return createHash('sha256')
    .update(JSON.stringify(ReportSnapshotSchema.parse(snapshot)))
    .digest('hex');
}
async function publicPersona(tx: Transaction, id: string, releaseId?: string) {
  const [row] = await tx
    .select({
      personaId: personas.id,
      releaseId: personaReleases.id,
      version: personaReleases.version,
      authorId: personas.ownerId,
      username: users.username,
      metadata: sql<unknown>`jsonb_build_object('title',${releaseSubmissions.snapshot}->'title','summary',${releaseSubmissions.snapshot}->'summary','platform',${releaseSubmissions.snapshot}->'platform')`,
    })
    .from(personas)
    .innerJoin(personaReleases, eq(personaReleases.personaId, personas.id))
    .innerJoin(
      releaseSubmissions,
      and(
        eq(releaseSubmissions.id, personaReleases.approvedSubmissionId),
        eq(releaseSubmissions.personaId, personas.id),
        eq(releaseSubmissions.releaseId, personaReleases.id),
      ),
    )
    .innerJoin(users, eq(users.id, personas.ownerId))
    .where(
      and(
        eq(personas.id, id),
        releaseId
          ? and(publicReleaseCondition, eq(personaReleases.id, releaseId))
          : publicCurrentCondition,
      ),
    )
    .limit(1);
  if (!row) throw unavailable();
  return {
    personaId: row.personaId,
    releaseId: row.releaseId,
    version: row.version,
    ...metadataSchema.parse(row.metadata),
    author: { id: row.authorId, username: row.username },
  };
}
async function publicComment(tx: Transaction, id: string) {
  const [row] = await tx
    .select({
      id: comments.id,
      revisionId: commentRevisions.id,
      body: commentRevisions.body,
      authorId: comments.authorId,
      username: users.username,
    })
    .from(comments)
    .innerJoin(
      commentRevisions,
      and(
        eq(commentRevisions.commentId, comments.id),
        eq(commentRevisions.id, comments.publicRevisionId),
        eq(commentRevisions.status, 'APPROVED'),
      ),
    )
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(
      and(
        eq(comments.id, id),
        eq(comments.visibility, 'normal'),
        eq(users.status, 'active'),
        isNotNull(users.emailVerifiedAt),
        sql`(${comments.parentId} IS NULL OR EXISTS(SELECT 1 FROM comments root WHERE root.id=${comments.parentId} AND root.first_published_at IS NOT NULL))`,
      ),
    )
    .limit(1);
  if (!row) throw unavailable();
  return row;
}
/** 先锁作品再锁评论，与评论及版本管理的资源锁顺序一致 */
export async function captureReportTarget(tx: Transaction, target: CreateReport['target']) {
  if (target.type === 'profile') {
    const snapshot = await publicProfileReportSnapshot(
      tx,
      target.userId,
      target.submissionId,
      true,
    );
    return {
      snapshot,
      type: snapshot.type,
      targetId: target.userId,
      targetRevisionId: target.submissionId,
      personaId: null,
      releaseId: null,
      commentId: null,
      commentRevisionId: null,
      profileUserId: target.userId,
      profileSubmissionId: target.submissionId,
      reportedUserId: snapshot.author.id,
      targetTitle: snapshot.title,
      contentHash: reportSnapshotHash(snapshot),
    };
  }
  let personaId: string;
  if (target.type === 'persona') personaId = target.personaId;
  else {
    const [location] = await tx
      .select({ personaId: comments.personaId })
      .from(comments)
      .where(eq(comments.id, target.commentId));
    if (!location) throw unavailable();
    personaId = location.personaId;
  }
  const [locked] = await tx
    .select({ id: personas.id })
    .from(personas)
    .where(eq(personas.id, personaId))
    .for('update');
  if (!locked) throw unavailable();
  const context = await publicPersona(
    tx,
    personaId,
    target.type === 'persona' ? target.releaseId : undefined,
  );
  let snapshot: Exclude<ReportSnapshot, { type: 'profile' }>;
  if (target.type === 'persona')
    snapshot = PersonaReportSnapshotSchema.parse({ type: 'persona', ...context });
  else {
    const [lockedComment] = await tx
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.id, target.commentId), eq(comments.personaId, personaId)))
      .for('share');
    if (!lockedComment) throw unavailable();
    const comment = await publicComment(tx, target.commentId);
    snapshot = CommentReportSnapshotSchema.parse({
      type: 'comment',
      ...context,
      author: { id: comment.authorId, username: comment.username },
      comment: { id: comment.id, revisionId: comment.revisionId, body: comment.body },
    });
  }
  return {
    snapshot,
    type: snapshot.type,
    targetId: snapshot.type === 'persona' ? snapshot.personaId : snapshot.comment.id,
    targetRevisionId:
      snapshot.type === 'persona' ? snapshot.releaseId : snapshot.comment.revisionId,
    personaId: snapshot.personaId,
    releaseId: snapshot.releaseId,
    reportedUserId: snapshot.author.id,
    targetTitle: snapshot.title,
    commentId: snapshot.type === 'comment' ? snapshot.comment.id : null,
    commentRevisionId: snapshot.type === 'comment' ? snapshot.comment.revisionId : null,
    profileUserId: null,
    profileSubmissionId: null,
    contentHash: reportSnapshotHash(snapshot),
  };
}
export async function reportPublicPath(tx: Transaction, snapshot: ReportSnapshot) {
  try {
    if (snapshot.type === 'profile') {
      const current = await publicProfileReportSnapshot(
        tx,
        snapshot.profile.userId,
        snapshot.profile.submissionId,
      );
      return '/users/' + current.author.username;
    }
    await publicPersona(
      tx,
      snapshot.personaId,
      snapshot.type === 'persona' ? snapshot.releaseId : undefined,
    );
    if (snapshot.type === 'comment') {
      await publicComment(tx, snapshot.comment.id);
      return '/personas/' + snapshot.personaId;
    }
    return '/personas/' + snapshot.personaId + '/releases/' + snapshot.releaseId;
  } catch (cause) {
    if (cause instanceof BusinessError && cause.code === 'NOT_FOUND') return null;
    throw cause;
  }
}
