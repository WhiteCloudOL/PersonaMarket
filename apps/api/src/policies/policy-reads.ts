import { createHash } from 'node:crypto';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { policyEntries, policySubmissions, policyRecords, users } from '@personamarket/database';
import {
  canonicalJson,
  ManagedPolicySchema,
  PolicyDraftFieldsSchema,
  PolicyFieldsSchema,
  PolicyReadQuerySchema,
  PolicyRecordResponseSchema,
  PolicyRecordSchema,
  PolicyRecordSnapshotSchema,
  PolicyRecordSummarySchema,
  PolicyRecordsQuerySchema,
  PolicyRecordsResponseSchema,
  PolicySlugSchema,
  PolicySubmissionResponseSchema,
  PolicySubmissionSchema,
  PolicySubmissionSummarySchema,
  PolicySubmissionsQuerySchema,
  PolicySubmissionsResponseSchema,
  PublicPolicySchema,
  PublicPolicyResponseSchema,
  PublicPoliciesResponseSchema,
  type ManagedPolicy,
  type PolicyDraftFields,
  type PolicyReadQuery,
  type PolicyRecordsQuery,
  type PolicySlug,
  type PolicySubmissionsQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';

type Entry = typeof policyEntries.$inferSelect;
type Submission = typeof policySubmissions.$inferSelect;
type SubmissionSummary = Omit<Submission, 'snapshot' | 'reason'>;
type Publication = Pick<
  Submission,
  'id' | 'slug' | 'status' | 'snapshot' | 'contentHash' | 'reviewedAt'
>;
type PublicationEntry = Pick<Entry, 'slug' | 'publishedId' | 'activatedAt'>;
type User = Pick<typeof users.$inferSelect, 'id' | 'username'>;

function invalidResponse() {
  return new BusinessError('INVALID_RESPONSE', '规则关联记录暂时不可用，请联系管理员');
}

function fixedPolicies<T extends { slug: PolicySlug }>(rows: readonly T[]): T[] {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  if (
    bySlug.size !== rows.length ||
    rows.some((row) => !PolicySlugSchema.options.includes(row.slug))
  )
    throw invalidResponse();
  return PolicySlugSchema.options.map((slug) => {
    const row = bySlug.get(slug);
    if (!row) throw new BusinessError('SERVICE_UNAVAILABLE', '公共规则尚未完成初始化');
    return row;
  });
}

export async function findPolicyEntry(tx: Transaction, slug: PolicySlug, lock = false) {
  const query = tx.select().from(policyEntries).where(eq(policyEntries.slug, slug)).limit(1);
  const [entry] = lock ? await query.for('update') : await query;
  if (!entry) throw new BusinessError('SERVICE_UNAVAILABLE', '公共规则尚未完成初始化');
  return entry;
}

export function policyFields(entry: Pick<Entry, 'title' | 'summary' | 'bodyMarkdown'>) {
  return PolicyDraftFieldsSchema.parse({
    title: entry.title,
    summary: entry.summary,
    bodyMarkdown: entry.bodyMarkdown,
  });
}

export function policyHash(fields: PolicyDraftFields) {
  return createHash('sha256')
    .update(canonicalJson(policyFields(fields)))
    .digest('hex');
}

async function loadSubmissions(tx: Transaction, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  const rows = unique.length
    ? await tx.select().from(policySubmissions).where(inArray(policySubmissions.id, unique))
    : [];
  return new Map<string, Submission>(rows.map((row) => [row.id, row]));
}

async function loadUsers(tx: Transaction, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  const rows = unique.length
    ? await tx
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(inArray(users.id, unique))
    : [];
  if (rows.length !== unique.length) throw invalidResponse();
  return new Map<string, User>(rows.map((row) => [row.id, row]));
}

function actor(id: string, accounts: ReadonlyMap<string, User>) {
  const account = accounts.get(id);
  if (!account) throw invalidResponse();
  return { id: account.id, username: account.username };
}

function submissionActorIds(rows: readonly SubmissionSummary[]) {
  return rows.flatMap((row) => [row.submittedBy, ...(row.reviewedBy ? [row.reviewedBy] : [])]);
}

function relatedSubmission(entry: Entry, id: string | null, rows: ReadonlyMap<string, Submission>) {
  if (id === null) return null;
  const row = rows.get(id);
  if (!row || row.slug !== entry.slug) throw invalidResponse();
  return row;
}

function frozenFields(row: Pick<Submission, 'snapshot' | 'contentHash'>) {
  const fields = PolicyFieldsSchema.safeParse(row.snapshot);
  if (!fields.success || policyHash(fields.data) !== row.contentHash) throw invalidResponse();
  return fields.data;
}

function publicValue(entry: PublicationEntry, publication: Publication | null) {
  if (entry.publishedId === null) {
    if (entry.activatedAt !== null) throw invalidResponse();
    return null;
  }
  if (
    !publication ||
    publication.id !== entry.publishedId ||
    publication.slug !== entry.slug ||
    publication.status !== 'approved' ||
    !publication.reviewedAt ||
    !entry.activatedAt
  )
    throw invalidResponse();
  return PublicPolicySchema.parse({
    ...frozenFields(publication),
    slug: entry.slug,
    publicationId: publication.id,
    publishedAt: publication.reviewedAt.toISOString(),
    activatedAt: entry.activatedAt.toISOString(),
  });
}

function submissionSummary(
  row: SubmissionSummary,
  accounts: ReadonlyMap<string, User>,
  viewerId: string,
) {
  if (!Array.isArray(row.contributors)) throw invalidResponse();
  return PolicySubmissionSummarySchema.parse({
    id: row.id,
    slug: row.slug,
    sourceRevision: row.sourceRevision,
    contentHash: row.contentHash,
    status: row.status,
    submittedBy: actor(row.submittedBy, accounts),
    submittedAt: row.submittedAt.toISOString(),
    reviewedBy: row.reviewedBy === null ? null : actor(row.reviewedBy, accounts),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    selfReview: row.selfReview,
    selfReviewRequired: row.status === 'pending' && row.contributors.includes(viewerId),
  });
}

async function assembleManagedPolicies(
  tx: Transaction,
  entries: readonly Entry[],
  viewerId: string,
): Promise<ManagedPolicy[]> {
  const submissions = await loadSubmissions(
    tx,
    entries
      .flatMap((entry) => [entry.publishedId, entry.latestSubmissionId])
      .filter((id): id is string => id !== null),
  );
  const accounts = await loadUsers(tx, [
    ...entries.map((entry) => entry.updatedBy).filter((id): id is string => id !== null),
    ...submissionActorIds([...submissions.values()]),
  ]);
  return entries.map((entry) => {
    const fields = policyFields(entry);
    const published = publicValue(entry, relatedSubmission(entry, entry.publishedId, submissions));
    const latest = relatedSubmission(entry, entry.latestSubmissionId, submissions);
    return ManagedPolicySchema.parse({
      ...fields,
      slug: entry.slug,
      revision: entry.revision,
      updatedAt: entry.updatedAt?.toISOString() ?? null,
      updatedBy: entry.updatedBy === null ? null : actor(entry.updatedBy, accounts).username,
      published,
      latestSubmission: latest ? submissionSummary(latest, accounts, viewerId) : null,
      hasUnpublishedChanges: published
        ? policyHash(fields) !== policyHash(published)
        : Object.values(fields).some((value) => value.length > 0),
    });
  });
}

export function managedPolicies(tx: Transaction, entries: readonly Entry[], viewerId: string) {
  return assembleManagedPolicies(tx, fixedPolicies(entries), viewerId);
}

export async function managedPolicy(tx: Transaction, entry: Entry, viewerId: string) {
  const [result] = await assembleManagedPolicies(tx, [entry], viewerId);
  if (!result) throw invalidResponse();
  return result;
}

function publicQuery(tx: Transaction) {
  // ON 内限制 approved，公开查询不读取草稿或未获批快照正文
  return tx
    .select({
      slug: policyEntries.slug,
      publishedId: policyEntries.publishedId,
      activatedAt: policyEntries.activatedAt,
      publication: {
        id: policySubmissions.id,
        slug: policySubmissions.slug,
        status: policySubmissions.status,
        snapshot: policySubmissions.snapshot,
        contentHash: policySubmissions.contentHash,
        reviewedAt: policySubmissions.reviewedAt,
      },
    })
    .from(policyEntries)
    .leftJoin(
      policySubmissions,
      and(
        eq(policySubmissions.id, policyEntries.publishedId),
        eq(policySubmissions.slug, policyEntries.slug),
        eq(policySubmissions.status, 'approved'),
      ),
    );
}

export async function publicPolicies(tx: Transaction) {
  const rows = fixedPolicies(await publicQuery(tx));
  const data = rows.flatMap((row) => {
    const value = publicValue(row, row.publication);
    return value
      ? [
          {
            title: value.title,
            summary: value.summary,
            slug: value.slug,
            publicationId: value.publicationId,
            publishedAt: value.publishedAt,
            activatedAt: value.activatedAt,
          },
        ]
      : [];
  });
  return PublicPoliciesResponseSchema.parse({ data });
}

export async function publicPolicy(tx: Transaction, slug: PolicySlug, query: PolicyReadQuery) {
  const input = PolicyReadQuerySchema.parse(query);
  const [row] = await publicQuery(tx).where(eq(policyEntries.slug, slug)).limit(1);
  if (!row) throw new BusinessError('SERVICE_UNAVAILABLE', '公共规则尚未完成初始化');
  if (
    row.publishedId === null ||
    (input.publicationId && input.publicationId.toLowerCase() !== row.publishedId)
  )
    throw new BusinessError('NOT_FOUND', '规则尚未公开或已下线');
  const data = publicValue(row, row.publication);
  if (!data) throw new BusinessError('NOT_FOUND', '规则尚未公开或已下线');
  return PublicPolicyResponseSchema.parse({ data });
}

const submissionSummaryColumns = {
  id: policySubmissions.id,
  slug: policySubmissions.slug,
  sourceRevision: policySubmissions.sourceRevision,
  contentHash: policySubmissions.contentHash,
  contributors: policySubmissions.contributors,
  status: policySubmissions.status,
  submittedBy: policySubmissions.submittedBy,
  submittedAt: policySubmissions.submittedAt,
  reviewedBy: policySubmissions.reviewedBy,
  reviewedAt: policySubmissions.reviewedAt,
  selfReview: policySubmissions.selfReview,
};

export async function listPolicySubmissions(
  tx: Transaction,
  entry: Entry,
  query: PolicySubmissionsQuery,
  viewerId: string,
) {
  const input = PolicySubmissionsQuerySchema.parse(query);
  const condition = and(
    eq(policySubmissions.slug, entry.slug),
    input.status === 'all' ? undefined : eq(policySubmissions.status, input.status),
  );
  const rows = await tx
    .select(submissionSummaryColumns)
    .from(policySubmissions)
    .where(condition)
    .orderBy(desc(policySubmissions.submittedAt), desc(policySubmissions.id))
    .limit(20)
    .offset((input.page - 1) * 20);
  const [total] = await tx.select({ value: count() }).from(policySubmissions).where(condition);
  if (!total) throw invalidResponse();
  const accounts = await loadUsers(tx, submissionActorIds(rows));
  return PolicySubmissionsResponseSchema.parse({
    data: rows.map((row) => submissionSummary(row, accounts, viewerId)),
    meta: { page: input.page, pageSize: 20, total: total.value, revision: entry.revision },
  });
}

export async function readPolicySubmission(
  tx: Transaction,
  entry: Entry,
  id: string,
  viewerId: string,
) {
  const [row] = await tx
    .select()
    .from(policySubmissions)
    .where(and(eq(policySubmissions.slug, entry.slug), eq(policySubmissions.id, id)))
    .limit(1);
  if (!row) throw new BusinessError('NOT_FOUND', '送审快照不存在或不可访问');
  const accounts = await loadUsers(tx, submissionActorIds([row]));
  return PolicySubmissionResponseSchema.parse({
    data: PolicySubmissionSchema.parse({
      ...submissionSummary(row, accounts, viewerId),
      snapshot: frozenFields(row),
      reason: row.reason,
    }),
    meta: { revision: entry.revision },
  });
}

const recordSummaryColumns = {
  id: policyRecords.id,
  actorId: policyRecords.actorId,
  action: policyRecords.action,
  submissionId: policyRecords.submissionId,
  reason: policyRecords.reason,
  selfReview: policyRecords.selfReview,
  fromRevision: policyRecords.fromRevision,
  toRevision: policyRecords.toRevision,
  createdAt: policyRecords.createdAt,
};

export async function listPolicyRecords(
  tx: Transaction,
  slug: PolicySlug,
  query: PolicyRecordsQuery,
) {
  const input = PolicyRecordsQuerySchema.parse(query);
  const condition = eq(policyRecords.slug, slug);
  const rows = await tx
    .select(recordSummaryColumns)
    .from(policyRecords)
    .where(condition)
    .orderBy(desc(policyRecords.createdAt), desc(policyRecords.id))
    .limit(20)
    .offset((input.page - 1) * 20);
  const [total] = await tx.select({ value: count() }).from(policyRecords).where(condition);
  if (!total) throw invalidResponse();
  const accounts = await loadUsers(
    tx,
    rows.map((row) => row.actorId),
  );
  return PolicyRecordsResponseSchema.parse({
    data: rows.map((row) =>
      PolicyRecordSummarySchema.parse({
        id: row.id,
        actor: actor(row.actorId, accounts),
        action: row.action,
        submissionId: row.submissionId,
        reason: row.reason,
        selfReview: row.selfReview,
        fromRevision: row.fromRevision,
        toRevision: row.toRevision,
        createdAt: row.createdAt.toISOString(),
      }),
    ),
    meta: { page: input.page, pageSize: 20, total: total.value },
  });
}

export async function readPolicyRecord(tx: Transaction, slug: PolicySlug, id: string) {
  const [row] = await tx
    .select()
    .from(policyRecords)
    .where(and(eq(policyRecords.slug, slug), eq(policyRecords.id, id)))
    .limit(1);
  if (!row) throw new BusinessError('NOT_FOUND', '规则修改记录不存在或不可访问');
  const accounts = await loadUsers(tx, [row.actorId]);
  return PolicyRecordResponseSchema.parse({
    data: PolicyRecordSchema.parse({
      id: row.id,
      actor: actor(row.actorId, accounts),
      action: row.action,
      submissionId: row.submissionId,
      reason: row.reason,
      selfReview: row.selfReview,
      before: row.beforeState,
      after: row.afterState,
      createdAt: row.createdAt.toISOString(),
    }),
  });
}

export async function policyRecordSnapshot(tx: Transaction, entry: Entry) {
  const submissions = await loadSubmissions(
    tx,
    [entry.publishedId, entry.latestSubmissionId].filter((id): id is string => id !== null),
  );
  const publication = relatedSubmission(entry, entry.publishedId, submissions);
  const published = publicValue(entry, publication);
  const latest = relatedSubmission(entry, entry.latestSubmissionId, submissions);
  const fields = policyFields(entry);
  return PolicyRecordSnapshotSchema.parse({
    ...fields,
    revision: entry.revision,
    contentHash: policyHash(fields),
    publishedId: published?.publicationId ?? null,
    publishedContentHash: published ? policyHash(published) : null,
    latestSubmissionId: latest?.id ?? null,
    latestSubmissionStatus: latest?.status ?? null,
  });
}
