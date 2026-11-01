import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import {
  guideEntries,
  guidePublications,
  guideRecords,
  users,
  authAuditEvents,
  type Database,
} from '@personamarket/database';
import {
  GuideFieldsSchema,
  GuideSlugSchema,
  PublicGuideSchema,
  PublicGuideResponseSchema,
  PublicGuidesResponseSchema,
  GuideSitemapResponseSchema,
  ManagedGuideSchema,
  AdminGuideResponseSchema,
  AdminGuidesResponseSchema,
  GuideRecordsResponseSchema,
  type GuideFields,
  type GuideSlug,
  type GuideWrite,
  type GuideAction,
  type GuideActionName,
  type AdminGuidesQuery,
  type GuideRecordsQuery,
  type ManagedGuide,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';

type Entry = typeof guideEntries.$inferSelect;
type Publication = typeof guidePublications.$inferSelect;
type Joined = { entry: Entry; publication: Publication | null; updatedBy: string | null };
type Command =
  | { action: 'edit'; slug: GuideSlug; expected: number; input: GuideWrite }
  | { action: GuideActionName; slug: GuideSlug; expected: number; input: GuideAction };
const publicColumns = {
  id: guidePublications.id,
  slug: guidePublications.slug,
  title: guidePublications.title,
  summary: guidePublications.summary,
  bodyMarkdown: guidePublications.bodyMarkdown,
  createdAt: guidePublications.createdAt,
};
function fields(value: GuideFields): GuideFields {
  return GuideFieldsSchema.parse({
    title: value.title,
    summary: value.summary,
    bodyMarkdown: value.bodyMarkdown,
  });
}
function hash(value: GuideFields) {
  return createHash('sha256')
    .update(JSON.stringify(fields(value)))
    .digest('hex');
}
function publicGuide(row: Pick<Publication, keyof typeof publicColumns>) {
  return PublicGuideSchema.parse({
    ...fields(row),
    slug: row.slug,
    publicationId: row.id,
    publishedAt: row.createdAt.toISOString(),
  });
}
function managed(row: Joined) {
  if (row.entry.publishedId && !row.publication)
    throw new BusinessError('INVALID_RESPONSE', '指南公开记录暂时不可用，请联系管理员');
  const published = row.publication ? publicGuide(row.publication) : null;
  return ManagedGuideSchema.parse({
    ...fields(row.entry),
    slug: row.entry.slug,
    status: row.entry.status,
    revision: row.entry.revision,
    updatedAt: row.entry.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    published,
    hasUnpublishedChanges: !published || hash(row.entry) !== hash(published),
  });
}
function digest(row: ManagedGuide) {
  return {
    ...fields(row),
    revision: row.revision,
    status: row.status,
    publishedId: row.published?.publicationId ?? null,
    contentHash: hash(row),
    publishedContentHash: row.published ? hash(row.published) : null,
  };
}
function ordered<T extends { slug: GuideSlug }>(rows: T[]) {
  return rows.sort(
    (a, b) => GuideSlugSchema.options.indexOf(a.slug) - GuideSlugSchema.options.indexOf(b.slug),
  );
}

@Injectable()
export class GuidesRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private joined(tx: Transaction) {
    return tx
      .select({ entry: guideEntries, publication: guidePublications, updatedBy: users.username })
      .from(guideEntries)
      .leftJoin(
        guidePublications,
        and(
          eq(guidePublications.slug, guideEntries.slug),
          eq(guidePublications.id, guideEntries.publishedId),
        ),
      )
      .leftJoin(users, eq(users.id, guideEntries.updatedBy));
  }
  private async state(tx: Transaction, slug: GuideSlug) {
    const [row] = await this.joined(tx).where(eq(guideEntries.slug, slug)).limit(1);
    if (!row) throw new BusinessError('NOT_FOUND', '指南不存在或尚未初始化');
    return managed(row);
  }
  private async publicRead<T>(operation: (tx: Transaction) => Promise<T>) {
    try {
      return await this.database.db.transaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL statement_timeout='2s'`);
          return operation(tx);
        },
        { isolationLevel: 'repeatable read' },
      );
    } catch (cause) {
      if (cause instanceof BusinessError) throw cause;
      throw new BusinessError('SERVICE_UNAVAILABLE', '指南暂时无法读取，请稍后重试', {
        cause,
        retryAfterSeconds: 1,
      });
    }
  }
  publicList() {
    return this.publicRead(async (tx) => {
      const rows = await tx
        .select(publicColumns)
        .from(guideEntries)
        .innerJoin(
          guidePublications,
          and(
            eq(guidePublications.slug, guideEntries.slug),
            eq(guidePublications.id, guideEntries.publishedId),
          ),
        )
        .where(eq(guideEntries.status, 'published'))
        .limit(9);
      return PublicGuidesResponseSchema.parse({ data: ordered(rows).map(publicGuide) });
    });
  }
  publicDetail(slug: GuideSlug) {
    return this.publicRead(async (tx) => {
      const [row] = await tx
        .select(publicColumns)
        .from(guideEntries)
        .innerJoin(
          guidePublications,
          and(
            eq(guidePublications.slug, guideEntries.slug),
            eq(guidePublications.id, guideEntries.publishedId),
          ),
        )
        .where(and(eq(guideEntries.status, 'published'), eq(guideEntries.slug, slug)))
        .limit(1);
      if (!row) throw new BusinessError('NOT_FOUND', '指南尚未公开或已撤回');
      return PublicGuideResponseSchema.parse({ data: publicGuide(row) });
    });
  }
  sitemap() {
    return this.publicRead(async (tx) => {
      const rows = await tx
        .select({ slug: guideEntries.slug, publishedAt: guidePublications.createdAt })
        .from(guideEntries)
        .innerJoin(
          guidePublications,
          and(
            eq(guidePublications.slug, guideEntries.slug),
            eq(guidePublications.id, guideEntries.publishedId),
          ),
        )
        .where(eq(guideEntries.status, 'published'))
        .limit(9);
      return GuideSitemapResponseSchema.parse({
        data: ordered(rows).map((row) => ({
          slug: row.slug,
          publishedAt: row.publishedAt.toISOString(),
        })),
      });
    });
  }
  list(actor: Identity, input: AdminGuidesQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const conditions: SQL[] = [];
        if (input.status !== 'all') conditions.push(eq(guideEntries.status, input.status));
        if (input.q) {
          const pattern = '%' + input.q.replace(/[\\%_]/g, '\\$&') + '%';
          const match = or(
            ilike(guideEntries.title, pattern),
            ilike(guideEntries.summary, pattern),
            ilike(guideEntries.slug, pattern),
          );
          if (match) conditions.push(match);
        }
        const rows = await this.joined(tx)
          .where(and(...conditions))
          .limit(9);
        return AdminGuidesResponseSchema.parse({
          data: ordered(rows.map(managed)).map((row) => ({
            slug: row.slug,
            title: row.title,
            summary: row.summary,
            status: row.status,
            revision: row.revision,
            updatedAt: row.updatedAt,
            updatedBy: row.updatedBy,
            hasUnpublishedChanges: row.hasUnpublishedChanges,
            publishedTitle: row.published?.title ?? null,
            publishedAt: row.published?.publishedAt ?? null,
          })),
        });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  read(actor: Identity, slug: GuideSlug) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        return AdminGuideResponseSchema.parse({ data: await this.state(tx, slug) });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  records(actor: Identity, slug: GuideSlug, input: GuideRecordsQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const condition = eq(guideRecords.slug, slug);
        const rows = await tx
          .select({
            id: guideRecords.id,
            actor: users.username,
            action: guideRecords.action,
            reason: guideRecords.reason,
            before: guideRecords.beforeState,
            after: guideRecords.afterState,
            createdAt: guideRecords.createdAt,
          })
          .from(guideRecords)
          .innerJoin(users, eq(users.id, guideRecords.actorId))
          .where(condition)
          .orderBy(desc(guideRecords.toRevision))
          .limit(20)
          .offset((input.page - 1) * 20);
        const [total] = await tx.select({ value: count() }).from(guideRecords).where(condition);
        return GuideRecordsResponseSchema.parse({
          data: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
          meta: { page: input.page, pageSize: 20, total: total?.value ?? 0 },
        });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  mutate(actor: Identity, command: Command, key: string, requestId: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const [locked] = await tx
          .select({ revision: guideEntries.revision })
          .from(guideEntries)
          .where(eq(guideEntries.slug, command.slug))
          .for('update');
        if (!locked) throw new BusinessError('NOT_FOUND', '指南不存在或尚未初始化');
        const before = await this.state(tx, command.slug);
        const operation = 'content.guides.' + command.action;
        if (await idempotentResult(tx, actor, operation, key, command))
          return AdminGuideResponseSchema.parse({ data: before });
        if (locked.revision !== command.expected)
          throw new BusinessError('REVISION_CONFLICT', '指南已变化，请核对最新修订');
        const common = {
          revision: sql`${guideEntries.revision}+1`,
          updatedBy: actor.account.id,
          updatedAt: new Date(),
        };
        let action: 'edited' | 'published' | 'withdrawn';
        if (command.action === 'edit') {
          if (hash(before) === hash(command.input))
            throw new BusinessError('CONFLICT', '指南编辑稿未变化，请核对当前内容');
          await tx
            .update(guideEntries)
            .set({ ...common, ...fields(command.input) })
            .where(eq(guideEntries.slug, command.slug));
          action = 'edited';
        } else if (command.action === 'publish') {
          if (before.status === 'published' && !before.hasUnpublishedChanges)
            throw new BusinessError('CONFLICT', '当前指南编辑稿已经发布');
          const [publication] = await tx
            .insert(guidePublications)
            .values({
              slug: command.slug,
              ...fields(before),
              contentHash: hash(before),
              actorId: actor.account.id,
            })
            .returning({ id: guidePublications.id });
          if (!publication) throw new Error('GUIDE_PUBLICATION_INSERT_FAILED');
          await tx
            .update(guideEntries)
            .set({ ...common, status: 'published', publishedId: publication.id })
            .where(eq(guideEntries.slug, command.slug));
          action = 'published';
        } else {
          if (before.status !== 'published')
            throw new BusinessError('CONFLICT', '指南当前未公开，请核对状态');
          await tx
            .update(guideEntries)
            .set({ ...common, status: 'withdrawn' })
            .where(eq(guideEntries.slug, command.slug));
          action = 'withdrawn';
        }
        const after = await this.state(tx, command.slug);
        const [record] = await tx
          .insert(guideRecords)
          .values({
            slug: command.slug,
            actorId: actor.account.id,
            action,
            reason: command.input.reason,
            beforeState: digest(before),
            afterState: digest(after),
            fromRevision: before.revision,
            toRevision: after.revision,
            requestId,
          })
          .returning({ id: guideRecords.id });
        if (!record) throw new Error('GUIDE_RECORD_INSERT_FAILED');
        await tx
          .insert(authAuditEvents)
          .values({ userId: actor.account.id, event: 'admin.guide_' + action, requestId });
        await rememberResult(tx, actor, operation, key, command, record.id);
        return AdminGuideResponseSchema.parse({ data: after });
      },
      { area: 'content', serializeWrites: true },
    );
  }
}
