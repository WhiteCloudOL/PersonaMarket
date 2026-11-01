import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { taxonomyManagementRecords, type Database } from '@personamarket/database';
import {
  ManagedTaxonomyEntrySchema,
  TaxonomyManagementDetailResponseSchema,
  TaxonomyManagementListResponseSchema,
  TaxonomyManagementRecordsResponseSchema,
  type TaxonomyKind,
  type ManagedTaxonomyEntry,
  type CreateTaxonomyEntry,
  type UpdateTaxonomyEntry,
  type TaxonomyAction,
  type TaxonomyManagementQuery,
  type TaxonomyManagementPagination,
} from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { DATABASE } from '../tokens.js';
import { administrationTransaction } from '../admin/administration-transaction.js';
import { lockIdentity, type Transaction } from '../auth/locked-identity.js';
import type { Identity } from '../auth/auth.service.js';
import { idempotentResult, rememberResult } from '../releases/release-helpers.js';
import {
  taxonomyListQueries,
  taxonomyTable,
  taxonomyUsageQuery,
  taxonomyView,
} from './taxonomy-queries.js';

type Change =
  | { action: 'created'; input: CreateTaxonomyEntry }
  | { action: 'updated'; id: string; expected: number; input: UpdateTaxonomyEntry }
  | { action: 'archived' | 'restored'; id: string; expected: number; input: TaxonomyAction };

function snapshot(row: ManagedTaxonomyEntry) {
  return {
    name: row.name,
    active: row.active,
    sortOrder: row.sortOrder,
    revision: row.revision,
    archivedAt: row.archivedAt,
  };
}

@Injectable()
export class TaxonomyManagementRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  private async row(tx: Transaction, kind: TaxonomyKind, id: string, lock = false) {
    const result = await tx.execute<{ data: unknown }>(
      sql`SELECT ${taxonomyView(kind)} AS data FROM ${taxonomyTable(kind)} t WHERE t.id=${id} ${lock ? sql`FOR UPDATE` : sql``}`,
    );
    if (!result.rows[0]) throw new BusinessError('NOT_FOUND', '分类或标签不存在');
    return ManagedTaxonomyEntrySchema.parse(result.rows[0].data);
  }
  private async detailWithin(tx: Transaction, kind: TaxonomyKind, id: string) {
    const data = await this.row(tx, kind, id);
    const usage = await tx.execute<{ usage: unknown }>(taxonomyUsageQuery(kind, data.id));
    return TaxonomyManagementDetailResponseSchema.parse({ data, usage: usage.rows[0]?.usage });
  }
  list(actor: Identity, kind: TaxonomyKind, input: TaxonomyManagementQuery) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        const query = taxonomyListQueries(kind, input);
        const rows = await tx.execute<{ data: unknown }>(query.rows);
        const count = await tx.execute<{ total: number }>(query.total);
        return TaxonomyManagementListResponseSchema.parse({
          data: rows.rows.map((row) => row.data),
          meta: { page: input.page, pageSize: input.pageSize, total: count.rows[0]?.total ?? 0 },
        });
      },
      { area: 'personas', isolationLevel: 'repeatable read' },
    );
  }
  detail(actor: Identity, kind: TaxonomyKind, id: string) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        return this.detailWithin(tx, kind, id);
      },
      { area: 'personas', isolationLevel: 'repeatable read' },
    );
  }
  records(actor: Identity, kind: TaxonomyKind, id: string, input: TaxonomyManagementPagination) {
    return administrationTransaction(
      this.database,
      async (tx) => {
        await lockIdentity(tx, actor, true, false);
        await this.row(tx, kind, id);
        const condition = sql`kind=${kind} AND entity_id=${id}`;
        const rows = await tx.execute<{ data: unknown }>(sql`SELECT jsonb_build_object(
        'id',r.id,'actor',u.username,'action',r.action,'reason',r.reason,
        'before',r.before_state,'after',r.after_state,'createdAt',r.created_at
      ) AS data FROM taxonomy_management_records r JOIN users u ON u.id=r.actor_id
      WHERE r.kind=${kind} AND r.entity_id=${id} ORDER BY r.created_at DESC,r.id DESC LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`);
        const count = await tx.execute<{ total: number }>(
          sql`SELECT count(*)::int AS total FROM taxonomy_management_records WHERE ${condition}`,
        );
        return TaxonomyManagementRecordsResponseSchema.parse({
          data: rows.rows.map((row) => row.data),
          meta: { page: input.page, pageSize: input.pageSize, total: count.rows[0]?.total ?? 0 },
        });
      },
      { area: 'personas', isolationLevel: 'repeatable read' },
    );
  }
  async change(
    actor: Identity,
    kind: TaxonomyKind,
    change: Change,
    key: string,
    requestId: string,
  ) {
    try {
      return await administrationTransaction(
        this.database,
        async (tx) => {
          await lockIdentity(tx, actor, true, false);
          const operation = 'taxonomy.' + kind + '.manage';
          const command =
            change.action === 'created' ? change : { ...change, id: change.id.toLowerCase() };
          const previous = await idempotentResult(tx, actor, operation, key, command);
          if (previous) return this.detailWithin(tx, kind, previous);
          const table = taxonomyTable(kind);
          const before =
            change.action === 'created' ? null : await this.row(tx, kind, change.id, true);
          if (before && change.action !== 'created' && before.revision !== change.expected)
            throw new BusinessError('REVISION_CONFLICT', '分类或标签已变化，请读取最新状态后核对');
          if (change.action === 'updated' && before?.archivedAt)
            throw new BusinessError('CONFLICT', '请先恢复已归档条目，再调整内容');
          if (change.action === 'archived') {
            if (before?.archivedAt)
              throw new BusinessError('CONFLICT', '条目已归档，请核对当前状态');
            const usage = await this.detailWithin(tx, kind, change.id);
            if (usage.usage.drafts || usage.usage.submissions)
              throw new BusinessError('CONFLICT', '条目已被草稿或版本引用，可以停用但不能归档');
          }
          if (change.action === 'restored' && !before?.archivedAt)
            throw new BusinessError('CONFLICT', '条目尚未归档，请核对当前状态');
          if (change.action === 'created' || change.action === 'updated') {
            const counts = await tx.execute<{ total: number; active: number }>(
              sql`SELECT count(*)::int AS total,count(*) FILTER (WHERE active AND archived_at IS NULL)::int AS active FROM ${table}`,
            );
            const count = counts.rows[0];
            if (change.action === 'created' && (count?.total ?? 0) >= 1000)
              throw new BusinessError(
                'CONFLICT',
                '此类型最多保留 1,000 个条目，请恢复已有归档条目',
              );
            if (change.input.active && !before?.active && (count?.active ?? 0) >= 100)
              throw new BusinessError(
                'CONFLICT',
                '此类型最多同时启用 100 个条目，请先停用不再使用的条目',
              );
          }
          let id: string;
          if (change.action === 'created') {
            const inserted = await tx.execute<{ id: string }>(
              sql`INSERT INTO ${table}(name,active,sort_order) VALUES(${change.input.name},${change.input.active},${change.input.sortOrder}) RETURNING id`,
            );
            const created = inserted.rows[0]?.id;
            if (!created) throw new Error('TAXONOMY_ENTRY_INSERT_FAILED');
            id = created;
          } else {
            id = change.id.toLowerCase();
            if (change.action === 'updated') {
              if (
                before &&
                before.name === change.input.name &&
                before.active === change.input.active &&
                before.sortOrder === change.input.sortOrder
              )
                throw new BusinessError('CONFLICT', '条目内容未变化，请核对当前状态');
              await tx.execute(
                sql`UPDATE ${table} SET name=${change.input.name},active=${change.input.active},sort_order=${change.input.sortOrder},revision=revision+1,updated_at=now() WHERE id=${id}`,
              );
            } else {
              await tx.execute(
                sql`UPDATE ${table} SET active=false,archived_at=${change.action === 'archived' ? sql`now()` : sql`NULL`},revision=revision+1,updated_at=now() WHERE id=${id}`,
              );
            }
          }
          const after = await this.row(tx, kind, id);
          await tx.insert(taxonomyManagementRecords).values({
            kind,
            entityId: id,
            actorId: actor.account.id,
            action: change.action,
            reason: change.input.reason,
            beforeState: before ? snapshot(before) : null,
            afterState: snapshot(after),
            requestId,
          });
          await rememberResult(tx, actor, operation, key, command, id);
          return this.detailWithin(tx, kind, id);
        },
        { area: 'personas', serializeWrites: true },
      );
    } catch (cause) {
      let error: unknown = cause;
      for (let depth = 0; depth < 8 && error instanceof Error; depth++) {
        if ('code' in error && error.code === '23505')
          throw new BusinessError('CONFLICT', '名称已存在，请核对已有或已归档条目', { cause });
        error = error.cause;
      }
      throw cause;
    }
  }
}
