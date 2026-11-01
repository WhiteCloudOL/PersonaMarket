import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, count, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { announcements, announcementRecords, users, type Database } from '@personamarket/database';
import {
  AnnouncementFieldsSchema,
  AnnouncementSitemapResponseSchema,
  ManagedAnnouncementSchema,
  PublicAnnouncementSchema,
  PublicAnnouncementResponseSchema,
  PublicAnnouncementsResponseSchema,
  AdminAnnouncementResponseSchema,
  AdminAnnouncementsResponseSchema,
  AnnouncementRecordsResponseSchema,
  type AnnouncementFields,
  type ManagedAnnouncement,
  type AnnouncementWrite,
  type AnnouncementAction,
  type AnnouncementActionName,
  type AdminAnnouncementsQuery,
  type PublicAnnouncementsQuery,
  type AnnouncementRecordsQuery,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';

type Row = typeof announcements.$inferSelect;
const publicColumns = {
  id: announcements.id,
  publishedSnapshot: announcements.publishedSnapshot,
  firstPublishedAt: announcements.firstPublishedAt,
  publishedAt: announcements.publishedAt,
};
type Command =
  | { action: 'create'; input: AnnouncementWrite }
  | { action: 'edit'; id: string; expected: number; input: AnnouncementWrite }
  | { action: AnnouncementActionName; id: string; expected: number; input: AnnouncementAction };
function fields(value: AnnouncementFields): AnnouncementFields {
  return { title: value.title, summary: value.summary, body: value.body, pinned: value.pinned };
}
function hash(value: AnnouncementFields) {
  return createHash('sha256')
    .update(JSON.stringify(fields(value)))
    .digest('hex');
}
function published(row: Pick<Row, keyof typeof publicColumns>) {
  if (row.publishedSnapshot === null) return null;
  return PublicAnnouncementSchema.parse({
    ...AnnouncementFieldsSchema.parse(row.publishedSnapshot),
    id: row.id,
    firstPublishedAt: row.firstPublishedAt?.toISOString(),
    publishedAt: row.publishedAt?.toISOString(),
  });
}
function managed(row: Row) {
  const snapshot = published(row);
  return ManagedAnnouncementSchema.parse({
    ...fields(row),
    id: row.id,
    status: row.status,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
    published: snapshot,
    hasUnpublishedChanges: !snapshot || hash(row) !== hash(snapshot),
  });
}
function digest(row: ManagedAnnouncement) {
  return {
    title: row.title,
    status: row.status,
    pinned: row.pinned,
    revision: row.revision,
    bodyCharacters: Array.from(row.body).length,
    contentHash: hash(row),
    publishedContentHash: row.published ? hash(row.published) : null,
  };
}

@Injectable()
export class AnnouncementsRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private async row(tx: Transaction, id: string, lock = false) {
    const query = tx.select().from(announcements).where(eq(announcements.id, id)).limit(1);
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new BusinessError('NOT_FOUND', '公告不存在或不可访问');
    return row;
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
      let current: unknown = cause;
      for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
        if (
          'code' in current &&
          ['57014', '55P03', '40P01', '40001'].includes(String(current.code))
        )
          throw new BusinessError('SERVICE_UNAVAILABLE', '公告暂时无法读取，请稍后重试', {
            cause,
            retryAfterSeconds: 1,
          });
        current = current.cause;
      }
      throw cause;
    }
  }
  listPublic(input: PublicAnnouncementsQuery) {
    return this.publicRead(async (tx) => {
      const condition = eq(announcements.status, 'published');
      const rows = await tx
        .select(publicColumns)
        .from(announcements)
        .where(condition)
        .orderBy(
          sql`(${announcements.publishedSnapshot}->>'pinned')::boolean DESC`,
          desc(announcements.publishedAt),
          desc(announcements.id),
        )
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await tx.select({ value: count() }).from(announcements).where(condition);
      return PublicAnnouncementsResponseSchema.parse({
        data: rows.map((row) => {
          const item = published(row);
          if (!item) throw new Error('PUBLISHED_ANNOUNCEMENT_SNAPSHOT_MISSING');
          const { body, ...summary } = item;
          void body;
          return summary;
        }),
        meta: { page: input.page, pageSize: input.pageSize, total: total?.value ?? 0 },
      });
    });
  }
  sitemap() {
    return this.publicRead(async (tx) => {
      const rows = await tx
        .select({ id: announcements.id, publishedAt: announcements.publishedAt })
        .from(announcements)
        .where(eq(announcements.status, 'published'))
        .orderBy(announcements.id)
        .limit(2000);
      return AnnouncementSitemapResponseSchema.parse({
        data: rows.map((row) => ({ id: row.id, publishedAt: row.publishedAt?.toISOString() })),
      });
    });
  }
  readPublic(id: string) {
    return this.publicRead(async (tx) => {
      const [row] = await tx
        .select(publicColumns)
        .from(announcements)
        .where(and(eq(announcements.id, id), eq(announcements.status, 'published')));
      if (!row) throw new BusinessError('NOT_FOUND', '公告不存在或不可访问');
      return PublicAnnouncementResponseSchema.parse({ data: published(row) });
    });
  }
  list(actor: Identity, input: AdminAnnouncementsQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const conditions: SQL[] = [];
        if (input.status !== 'all') conditions.push(eq(announcements.status, input.status));
        if (input.q) {
          const pattern = '%' + input.q.replace(/[\\%_]/g, '\\$&') + '%';
          conditions.push(
            sql`(${ilike(announcements.title, pattern)} OR ${announcements.id}::text=${input.q.toLowerCase()})`,
          );
        }
        const condition = and(...conditions);
        const rows = await tx
          .select()
          .from(announcements)
          .where(condition)
          .orderBy(desc(announcements.updatedAt), desc(announcements.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize);
        const [total] = await tx.select({ value: count() }).from(announcements).where(condition);
        return AdminAnnouncementsResponseSchema.parse({
          data: rows.map((row) => {
            const { body, published, ...summary } = managed(row);
            void body;
            return { ...summary, publishedTitle: published?.title ?? null };
          }),
          meta: { page: input.page, pageSize: input.pageSize, total: total?.value ?? 0 },
        });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  detail(actor: Identity, id: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        return AdminAnnouncementResponseSchema.parse({ data: managed(await this.row(tx, id)) });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  records(actor: Identity, id: string, input: AnnouncementRecordsQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        await this.row(tx, id);
        const rows = await tx
          .select({
            id: announcementRecords.id,
            actor: users.username,
            action: announcementRecords.action,
            reason: announcementRecords.reason,
            before: announcementRecords.beforeState,
            after: announcementRecords.afterState,
            createdAt: announcementRecords.createdAt,
          })
          .from(announcementRecords)
          .innerJoin(users, eq(users.id, announcementRecords.actorId))
          .where(eq(announcementRecords.announcementId, id))
          .orderBy(desc(announcementRecords.createdAt), desc(announcementRecords.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize);
        const [total] = await tx
          .select({ value: count() })
          .from(announcementRecords)
          .where(eq(announcementRecords.announcementId, id));
        return AnnouncementRecordsResponseSchema.parse({
          data: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
          meta: { page: input.page, pageSize: input.pageSize, total: total?.value ?? 0 },
        });
      },
      { area: 'content', isolationLevel: 'repeatable read' },
    );
  }
  change(actor: Identity, command: Command, key: string, requestId: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const operation = 'content.announcements.manage';
        const previous = await idempotentResult(tx, actor, operation, key, command);
        if (previous)
          return AdminAnnouncementResponseSchema.parse({
            data: managed(await this.row(tx, previous)),
          });
        const before =
          command.action === 'create' ? null : managed(await this.row(tx, command.id, true));
        if (before && command.action !== 'create' && before.revision !== command.expected)
          throw new BusinessError('REVISION_CONFLICT', '公告已变化，请读取最新状态后核对');
        let id: string;
        let action: 'created' | 'edited' | 'published' | 'withdrawn' | 'archived' | 'restored';
        if (command.action === 'create') {
          const [total] = await tx.select({ value: count() }).from(announcements);
          if ((total?.value ?? 0) >= 2000)
            throw new BusinessError('CONFLICT', '最多保留 2,000 条公告，请维护已有公告');
          const [row] = await tx
            .insert(announcements)
            .values({
              ...fields(command.input),
              createdBy: actor.account.id,
              updatedBy: actor.account.id,
            })
            .returning({ id: announcements.id });
          if (!row) throw new Error('ANNOUNCEMENT_INSERT_FAILED');
          id = row.id;
          action = 'created';
        } else {
          if (!before) throw new Error('ANNOUNCEMENT_BEFORE_MISSING');
          id = before.id;
          const common = {
            revision: sql`${announcements.revision}+1`,
            updatedAt: new Date(),
            updatedBy: actor.account.id,
          };
          if (command.action === 'edit') {
            if (before.status === 'archived')
              throw new BusinessError('CONFLICT', '请先恢复公告，再调整编辑稿');
            if (hash(before) === hash(command.input))
              throw new BusinessError('CONFLICT', '公告编辑稿未变化，请核对当前内容');
            await tx
              .update(announcements)
              .set({ ...common, ...fields(command.input) })
              .where(eq(announcements.id, id));
            action = 'edited';
          } else if (command.action === 'publish') {
            if (before.status === 'archived')
              throw new BusinessError('CONFLICT', '请先恢复公告，再核对发布');
            if (before.status === 'published' && !before.hasUnpublishedChanges)
              throw new BusinessError('CONFLICT', '当前编辑稿已经发布');
            await tx
              .update(announcements)
              .set({
                ...common,
                status: 'published',
                publishedSnapshot: fields(before),
                publishedAt: sql`now()`,
                firstPublishedAt: sql`COALESCE(${announcements.firstPublishedAt},now())`,
              })
              .where(eq(announcements.id, id));
            action = 'published';
          } else if (command.action === 'withdraw') {
            if (before.status !== 'published')
              throw new BusinessError('CONFLICT', '公告当前未公开，请核对状态');
            await tx
              .update(announcements)
              .set({ ...common, status: 'withdrawn' })
              .where(eq(announcements.id, id));
            action = 'withdrawn';
          } else if (command.action === 'archive') {
            if (before.status === 'archived') throw new BusinessError('CONFLICT', '公告已归档');
            await tx
              .update(announcements)
              .set({ ...common, status: 'archived' })
              .where(eq(announcements.id, id));
            action = 'archived';
          } else {
            if (before.status !== 'archived') throw new BusinessError('CONFLICT', '公告尚未归档');
            await tx
              .update(announcements)
              .set({ ...common, status: before.published ? 'withdrawn' : 'draft' })
              .where(eq(announcements.id, id));
            action = 'restored';
          }
        }
        const after = managed(await this.row(tx, id));
        await tx.insert(announcementRecords).values({
          announcementId: id,
          actorId: actor.account.id,
          action,
          reason: command.input.reason,
          beforeState: before ? digest(before) : null,
          afterState: digest(after),
          requestId,
        });
        await rememberResult(tx, actor, operation, key, command, id);
        return AdminAnnouncementResponseSchema.parse({ data: after });
      },
      { area: 'content', serializeWrites: true },
    );
  }
}
