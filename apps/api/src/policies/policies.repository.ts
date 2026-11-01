import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  authAuditEvents,
  policyEntries,
  policyRecords,
  type Database,
} from '@personamarket/database';
import {
  AdminPoliciesResponseSchema,
  AdminPolicyResponseSchema,
  type PolicySlug,
  type PolicyReadQuery,
  type PolicyWrite,
  type SubmitPolicy,
  type WithdrawPolicy,
  type ReviewPolicy,
  type UnpublishPolicy,
  type ActivatePolicy,
  type PolicySubmissionsQuery,
  type PolicyRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';
import {
  findPolicyEntry,
  managedPolicies,
  managedPolicy,
  publicPolicies,
  publicPolicy,
  listPolicySubmissions,
  readPolicySubmission,
  listPolicyRecords,
  readPolicyRecord,
  policyRecordSnapshot,
} from './policy-reads.js';
import { applyPolicyCommand, type PolicyCommand } from './policy-commands.js';

@Injectable()
export class PoliciesRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}

  private async publicQuery<T>(read: (tx: Transaction) => Promise<T>) {
    try {
      return await this.database.db.transaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL statement_timeout='2s'`);
          return read(tx);
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    } catch (cause) {
      if (cause instanceof BusinessError) throw cause;
      throw new BusinessError('SERVICE_UNAVAILABLE', '公共规则暂时无法读取，请稍后重试', {
        cause,
        retryAfterSeconds: 1,
      });
    }
  }
  publicList() {
    return this.publicQuery(publicPolicies);
  }
  publicRead(slug: PolicySlug, input: PolicyReadQuery) {
    return this.publicQuery((tx) => publicPolicy(tx, slug, input));
  }

  private privateRead<T>(actor: Identity, read: (tx: Transaction) => Promise<T>) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        return read(tx);
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  list(actor: Identity) {
    return this.privateRead(actor, async (tx) => {
      const values = await managedPolicies(
        tx,
        await tx.select().from(policyEntries),
        actor.account.id,
      );
      return AdminPoliciesResponseSchema.parse({
        data: values.map((value) => ({
          slug: value.slug,
          title: value.title,
          summary: value.summary,
          revision: value.revision,
          updatedAt: value.updatedAt,
          updatedBy: value.updatedBy,
          latestSubmission: value.latestSubmission,
          hasUnpublishedChanges: value.hasUnpublishedChanges,
          publishedTitle: value.published?.title ?? null,
          publishedAt: value.published?.publishedAt ?? null,
        })),
      });
    });
  }
  read(actor: Identity, slug: PolicySlug) {
    return this.privateRead(actor, async (tx) =>
      AdminPolicyResponseSchema.parse({
        data: await managedPolicy(tx, await findPolicyEntry(tx, slug), actor.account.id),
      }),
    );
  }
  submissions(actor: Identity, slug: PolicySlug, input: PolicySubmissionsQuery) {
    return this.privateRead(actor, async (tx) =>
      listPolicySubmissions(tx, await findPolicyEntry(tx, slug), input, actor.account.id),
    );
  }
  submission(actor: Identity, slug: PolicySlug, id: string) {
    return this.privateRead(actor, async (tx) =>
      readPolicySubmission(tx, await findPolicyEntry(tx, slug), id, actor.account.id),
    );
  }
  records(actor: Identity, slug: PolicySlug, input: PolicyRecordsQuery) {
    return this.privateRead(actor, async (tx) => {
      await findPolicyEntry(tx, slug);
      return listPolicyRecords(tx, slug, input);
    });
  }
  record(actor: Identity, slug: PolicySlug, id: string) {
    return this.privateRead(actor, async (tx) => {
      await findPolicyEntry(tx, slug);
      return readPolicyRecord(tx, slug, id);
    });
  }
  write(
    actor: Identity,
    slug: PolicySlug,
    input: PolicyWrite,
    expected: number,
    key: string,
    requestId: string,
  ) {
    return this.mutate(actor, slug, { kind: 'write', input }, expected, key, requestId);
  }
  submit(
    actor: Identity,
    slug: PolicySlug,
    input: SubmitPolicy,
    expected: number,
    key: string,
    requestId: string,
  ) {
    return this.mutate(actor, slug, { kind: 'submit', input }, expected, key, requestId);
  }
  withdraw(
    actor: Identity,
    slug: PolicySlug,
    id: string,
    input: WithdrawPolicy,
    expected: number,
    key: string,
    requestId: string,
  ) {
    return this.mutate(actor, slug, { kind: 'withdraw', id, input }, expected, key, requestId);
  }
  review(
    actor: Identity,
    slug: PolicySlug,
    id: string,
    input: ReviewPolicy,
    expected: number,
    key: string,
    requestId: string,
  ) {
    return this.mutate(actor, slug, { kind: 'review', id, input }, expected, key, requestId);
  }
  unpublish(
    actor: Identity,
    slug: PolicySlug,
    input: UnpublishPolicy,
    expected: number,
    key: string,
    requestId: string,
  ) {
    return this.mutate(actor, slug, { kind: 'unpublish', input }, expected, key, requestId);
  }
  activate(
    actor: Identity,
    slug: PolicySlug,
    input: ActivatePolicy,
    expected: number,
    key: string,
    requestId: string,
  ) {
    return this.mutate(actor, slug, { kind: 'activate', input }, expected, key, requestId);
  }

  private mutate(
    actor: Identity,
    slug: PolicySlug,
    command: PolicyCommand,
    expected: number,
    key: string,
    requestId: string,
  ) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        const locked = await lockIdentity(tx, actor, true, false);
        const entry = await findPolicyEntry(tx, slug, true);
        const operation = 'policy.' + command.kind;
        const signature = { slug, expected, ...command };
        // 已成功请求的显式核对仍需有效管理员身份，但不再次执行自审或高危动作。
        if (await idempotentResult(tx, actor, operation, key, signature))
          return AdminPolicyResponseSchema.parse({
            data: await managedPolicy(tx, entry, actor.account.id),
          });
        if (entry.revision !== expected)
          throw new BusinessError('REVISION_CONFLICT', '规则已变化，请核对最新修订');
        const before = await policyRecordSnapshot(tx, entry);
        const result = await applyPolicyCommand(tx, locked, entry, command);
        const after = await policyRecordSnapshot(tx, result.entry);
        const [record] = await tx
          .insert(policyRecords)
          .values({
            slug,
            actorId: locked.account.id,
            action: result.action,
            submissionId: result.submissionId,
            reason: command.input.reason,
            selfReview: result.selfReview,
            beforeState: before,
            afterState: after,
            fromRevision: entry.revision,
            toRevision: result.entry.revision,
            requestId,
          })
          .returning({ id: policyRecords.id });
        if (!record) throw new Error('POLICY_RECORD_INSERT_FAILED');
        await tx
          .insert(authAuditEvents)
          .values({ userId: locked.account.id, event: 'policy.' + result.action, requestId });
        await rememberResult(tx, actor, operation, key, signature, record.id);
        return AdminPolicyResponseSchema.parse({
          data: await managedPolicy(tx, result.entry, locked.account.id),
        });
      },
      { area: 'content', serializeWrites: true },
    );
  }
}
