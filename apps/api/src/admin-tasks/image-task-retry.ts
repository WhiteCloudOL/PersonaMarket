import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  assetJobs,
  assets,
  marketImportAssets,
  marketImports,
  users,
} from '@personamarket/database';
import {
  BusinessError,
  assertAssetQuota,
  assertImageImportCapacity,
  checkedImageUrl,
  readMediaSettings,
  assertMediaRemote,
  type FailedQueueSample,
} from '@personamarket/server';
import type { RetryAdminTask } from '@personamarket/contracts';
import type { Transaction } from '../auth/locked-identity.js';
import { taskFailureQuery } from './task-failure-query.js';
import { taskFailureRecordSchema, taskFailureVersion } from './task-failure-view.js';

export async function prepareImageTaskRetry(
  tx: Transaction,
  target: { source: 'image' | 'market_image'; id: string },
  input: RetryAdminTask,
  samples: FailedQueueSample[],
) {
  const locked = await tx.execute<{ locked: boolean }>(
    sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${target.id},0)) AS locked`,
  );
  if (!locked.rows[0]?.locked) throw new BusinessError('CONFLICT', '任务正在处理，请刷新后再试');
  const found = await tx.execute(sql`
    SELECT owner_id,NULL::uuid AS preview_id FROM asset_jobs WHERE ${target.source}='image' AND id=${target.id}::uuid
    UNION ALL SELECT p.owner_id,p.id FROM market_import_assets a JOIN market_imports p ON p.id=a.preview_id
      WHERE ${target.source}='market_image' AND a.id=${target.id}::uuid`);
  if (!found.rows[0]) throw new BusinessError('NOT_FOUND', '图片任务不存在或已清理');
  const subject = z
    .object({ owner_id: z.uuid(), preview_id: z.uuid().nullable() })
    .parse(found.rows[0]);
  const [owner] = await tx
    .select()
    .from(users)
    .where(eq(users.id, subject.owner_id))
    .for('no key update');
  if (owner?.status !== 'active' || !owner.emailVerifiedAt)
    throw new BusinessError('CONFLICT', '所属账号不可用或邮箱尚未验证，请先处理账号状态');
  if (subject.preview_id) {
    const [preview] = await tx
      .select({
        state: marketImports.state,
        consumedAt: marketImports.consumedAt,
        ownerId: marketImports.ownerId,
        expired: sql<boolean>`${marketImports.expiresAt}<=clock_timestamp()`,
      })
      .from(marketImports)
      .where(eq(marketImports.id, subject.preview_id))
      .for('update');
    if (
      !preview ||
      preview.ownerId !== owner.id ||
      preview.state !== 'ready' ||
      preview.consumedAt ||
      preview.expired
    )
      throw new BusinessError('CONFLICT', '导入预览已过期、已使用或不可继续，请重新导入');
  }
  const [remote] =
    target.source === 'image'
      ? await tx.select().from(assetJobs).where(eq(assetJobs.id, target.id)).for('update')
      : [];
  const [market] =
    target.source === 'market_image'
      ? await tx
          .select()
          .from(marketImportAssets)
          .where(
            and(
              eq(marketImportAssets.id, target.id),
              eq(marketImportAssets.previewId, subject.preview_id ?? target.id),
            ),
          )
          .for('update')
      : [];
  const sourceUrl = remote?.sourceUrl ?? market?.sourceUrl;
  if (!sourceUrl) throw new BusinessError('CONFLICT', '此图片没有可重试的远程来源，请重新上传');
  checkedImageUrl(sourceUrl);
  assertMediaRemote(await readMediaSettings(tx, true), sourceUrl);
  const topic = target.source === 'image' ? 'asset.import' : 'market.image';
  const reference = target.source === 'image' ? 'jobId' : 'assetId';
  // 与列表相同的最新事件顺序，锁定分发状态后再比较完整版本，避免覆盖进行中的分发。
  await tx.execute(sql`SELECT id FROM outbox_events WHERE topic=${topic} AND lower(payload->>${reference})=${target.id}
    ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`);
  const failure = await tx.execute(
    taskFailureQuery({ page: 1, category: 'all', stage: 'all' }, samples, target),
  );
  const current = z.object({ items: z.array(taskFailureRecordSchema) }).parse(failure.rows[0])
    .items[0];
  if (!current || taskFailureVersion(current) !== input.expectedVersion)
    throw new BusinessError('REVISION_CONFLICT', '任务状态已变化，请刷新并核对后重试');
  await assertImageImportCapacity(tx, owner.id, target);
  if (target.source === 'image') {
    const [existing] = await tx.select().from(assets).where(eq(assets.id, target.id));
    if (existing && (existing.ownerId !== owner.id || existing.purpose !== 'content'))
      throw new BusinessError('CONFLICT', '已有素材与任务归属不一致，请核对原任务');
    await assertAssetQuota(tx, owner.id, existing ? 0 : 1, existing ? 0 : 1);
  } else {
    await assertAssetQuota(tx, owner.id, 0, 0);
  }
  return {
    topic,
    payload:
      target.source === 'image'
        ? { schemaVersion: 1, jobId: target.id }
        : { schemaVersion: 1, assetId: target.id },
    previousEventId: current.event_id,
    reset: async () => {
      if (target.source === 'image')
        await tx
          .update(assetJobs)
          .set({ status: 'pending', errorCode: null, assetId: null })
          .where(eq(assetJobs.id, target.id));
      else
        await tx
          .update(marketImportAssets)
          .set({ status: 'queued' })
          .where(eq(marketImportAssets.id, target.id));
    },
  };
}
