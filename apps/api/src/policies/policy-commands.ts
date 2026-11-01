import { and, eq, gt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { policyEntries, policySubmissions, policyRecords, userMfa } from '@personamarket/database';
import {
  PolicyFieldsSchema,
  policyNextSubmissionStatus,
  type PolicyWrite,
  type SubmitPolicy,
  type WithdrawPolicy,
  type ReviewPolicy,
  type UnpublishPolicy,
  type ActivatePolicy,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { requireRecentVerification } from '../auth/verification-policy.js';
import type { lockIdentity, Transaction } from '../auth/locked-identity.js';
import { policyFields, policyHash } from './policy-reads.js';

type Entry = typeof policyEntries.$inferSelect;
type Submission = typeof policySubmissions.$inferSelect;
type LockedIdentity = Awaited<ReturnType<typeof lockIdentity>>;
type EntryPatch = Partial<
  Pick<
    Entry,
    | 'title'
    | 'summary'
    | 'bodyMarkdown'
    | 'publishedId'
    | 'activatedAt'
    | 'latestSubmissionId'
    | 'approvedThroughRevision'
  >
>;
export type PolicyCommand =
  | { kind: 'write'; input: PolicyWrite }
  | { kind: 'submit'; input: SubmitPolicy }
  | { kind: 'withdraw'; id: string; input: WithdrawPolicy }
  | { kind: 'review'; id: string; input: ReviewPolicy }
  | { kind: 'unpublish'; input: UnpublishPolicy }
  | { kind: 'activate'; input: ActivatePolicy };
type Action = typeof policyRecords.$inferInsert.action;

async function databaseTime(tx: Transaction) {
  const result = await tx.execute(sql`SELECT clock_timestamp() AS at`);
  return z.object({ at: z.coerce.date() }).parse(result.rows[0]).at;
}

async function updateEntry(
  tx: Transaction,
  entry: Entry,
  actorId: string,
  at: Date,
  patch: EntryPatch,
) {
  const [updated] = await tx
    .update(policyEntries)
    .set({
      ...patch,
      revision: entry.revision + 1,
      updatedBy: actorId,
      updatedAt: at,
    })
    .where(and(eq(policyEntries.slug, entry.slug), eq(policyEntries.revision, entry.revision)))
    .returning();
  if (!updated) throw new BusinessError('REVISION_CONFLICT', '规则已变化，请核对最新修订');
  return updated;
}

async function findSubmission(tx: Transaction, entry: Entry, id: string) {
  const [row] = await tx
    .select()
    .from(policySubmissions)
    .where(and(eq(policySubmissions.slug, entry.slug), eq(policySubmissions.id, id)))
    .limit(1)
    .for('update');
  if (!row) throw new BusinessError('NOT_FOUND', '送审快照不存在或不可访问');
  return row;
}

function pending(entry: Entry, row: Submission, action: 'withdraw' | 'approve' | 'reject') {
  const next = policyNextSubmissionStatus(row.status, action);
  if (entry.latestSubmissionId !== row.id || !next)
    throw new BusinessError('CONFLICT', '这份快照已完成处理，请核对当前送审状态');
  return next;
}

export async function applyPolicyCommand(
  tx: Transaction,
  actor: LockedIdentity,
  entry: Entry,
  command: PolicyCommand,
) {
  const at = await databaseTime(tx);
  let patch: EntryPatch = {};
  let action: Action;
  let submissionId: string | null = null;
  let selfReview = false;
  if (command.kind === 'write') {
    const fields = policyFields(command.input);
    if (policyHash(fields) === policyHash(entry))
      throw new BusinessError('CONFLICT', '编辑稿未变化，请核对当前内容');
    patch = fields;
    action = 'edited';
  } else if (command.kind === 'submit') {
    const fields = PolicyFieldsSchema.safeParse(policyFields(entry));
    if (!fields.success)
      throw new BusinessError('VALIDATION_FAILED', '请先保存完整的规则标题和正文');
    const hash = policyHash(fields.data);
    const [existing] = await tx
      .select({ status: policySubmissions.status })
      .from(policySubmissions)
      .where(and(eq(policySubmissions.slug, entry.slug), eq(policySubmissions.status, 'pending')))
      .limit(1);
    if (existing) throw new BusinessError('CONFLICT', '已有待审快照，请先处理或撤回');
    const [approved] = await tx
      .select({ id: policySubmissions.id })
      .from(policySubmissions)
      .where(
        and(
          eq(policySubmissions.slug, entry.slug),
          eq(policySubmissions.status, 'approved'),
          eq(policySubmissions.contentHash, hash),
        ),
      )
      .limit(1);
    if (approved)
      throw new BusinessError('CONFLICT', '这份正文已有批准版本，请从历史记录激活该版本');
    // 只在批准时推进基线。拒绝、撤回或换人送审不能清除未获批编辑者。
    const edits = await tx
      .select({ actorId: policyRecords.actorId })
      .from(policyRecords)
      .where(
        and(
          eq(policyRecords.slug, entry.slug),
          eq(policyRecords.action, 'edited'),
          gt(policyRecords.toRevision, entry.approvedThroughRevision),
          lte(policyRecords.toRevision, entry.revision),
        ),
      );
    const contributors = [
      ...new Set([...edits.map((row) => row.actorId), actor.account.id]),
    ].sort();
    const [inserted] = await tx
      .insert(policySubmissions)
      .values({
        slug: entry.slug,
        sourceRevision: entry.revision,
        snapshot: fields.data,
        contentHash: hash,
        contributors,
        submittedBy: actor.account.id,
        submittedAt: at,
      })
      .returning({ id: policySubmissions.id });
    if (!inserted) throw new Error('POLICY_SUBMISSION_INSERT_FAILED');
    submissionId = inserted.id;
    patch = { latestSubmissionId: inserted.id };
    action = 'submitted';
  } else if (command.kind === 'withdraw') {
    const row = await findSubmission(tx, entry, command.id);
    const status = pending(entry, row, 'withdraw');
    await tx
      .update(policySubmissions)
      .set({ status, reason: command.input.reason })
      .where(eq(policySubmissions.id, row.id));
    submissionId = row.id;
    action = 'withdrawn';
  } else if (command.kind === 'review') {
    const row = await findSubmission(tx, entry, command.id);
    const status = pending(entry, row, command.input.decision);
    selfReview = row.contributors.includes(actor.account.id);
    if (selfReview) {
      if (!command.input.selfReviewConfirmed || !command.input.reason.trim())
        throw new BusinessError(
          'FORBIDDEN',
          '你参与了这份规则的编辑或送审，自审需要明确确认与理由',
        );
      const [mfa] = await tx
        .select({ confirmedAt: userMfa.confirmedAt })
        .from(userMfa)
        .where(eq(userMfa.userId, actor.account.id));
      // 身份行已锁定，绑定状态与近期凭据均在执行事务内读取。
      requireRecentVerification({ ...actor, mfaEnrolled: Boolean(mfa?.confirmedAt) }, true);
    }
    await tx
      .update(policySubmissions)
      .set({
        status,
        reviewedBy: actor.account.id,
        reviewedAt: at,
        reason: command.input.reason,
        selfReview,
      })
      .where(eq(policySubmissions.id, row.id));
    if (status === 'approved')
      patch = {
        publishedId: row.id,
        activatedAt: at,
        // 送审后继续编辑的修订仍属未批准谱系，不能被本次批准一并清除。
        approvedThroughRevision: Math.max(entry.approvedThroughRevision, row.sourceRevision),
      };
    submissionId = row.id;
    action = status === 'approved' ? 'approved' : 'rejected';
  } else if (command.kind === 'unpublish') {
    if (!entry.publishedId) throw new BusinessError('CONFLICT', '规则当前未公开，请核对状态');
    submissionId = entry.publishedId;
    patch = { publishedId: null, activatedAt: null };
    action = 'unpublished';
  } else {
    const row = await findSubmission(tx, entry, command.input.publicationId);
    if (row.status !== 'approved') throw new BusinessError('NOT_FOUND', '批准版本不存在或不可访问');
    if (entry.publishedId === row.id)
      throw new BusinessError('CONFLICT', '该批准版本已经是当前公开版');
    patch = { publishedId: row.id, activatedAt: at };
    submissionId = row.id;
    action = 'activated';
  }
  return {
    entry: await updateEntry(tx, entry, actor.account.id, at, patch),
    action,
    submissionId,
    selfReview,
  };
}
