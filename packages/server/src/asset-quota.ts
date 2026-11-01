import { sql } from 'drizzle-orm';
import type { Database } from '@personamarket/database';
import { BusinessError } from './errors.js';
import { readMediaSettings } from './media-settings.js';
type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

/** 调用方先锁定用户，使普通图片和导入包的在线任务共享并发名额 */
export async function assertImageImportCapacity(
  tx: Transaction,
  ownerId: string,
  retrying?: { source: 'image' | 'market_image'; id: string },
) {
  const settings = await readMediaSettings(tx, true);
  if (!settings.remoteImportsEnabled)
    throw new BusinessError('FORBIDDEN', '管理员已关闭在线图片导入');
  const result = await tx.execute<{ total: string }>(sql`
    SELECT (
      (SELECT count(*) FROM asset_jobs WHERE owner_id=${ownerId} AND status IN ('pending','processing')
        ${retrying?.source === 'image' ? sql`AND id<>${retrying.id}::uuid` : sql``})
      + (SELECT count(*) FROM market_import_assets a JOIN market_imports i ON i.id=a.preview_id
         WHERE i.owner_id=${ownerId} AND i.state='ready' AND i.consumed_at IS NULL
         AND i.expires_at>now() AND a.status IN ('queued','processing')
         ${retrying?.source === 'market_image' ? sql`AND a.id<>${retrying.id}::uuid` : sql``})
    )::text AS total`);
  if (Number(result.rows[0]?.total ?? 0) >= settings.maxConcurrentImports)
    throw new BusinessError(
      'RATE_LIMITED',
      `最多同时处理 ${settings.maxConcurrentImports} 个图片导入任务`,
    );
}

/** 调用方已锁定用户；正式素材和临时导入共同使用同一配额 */
export async function assertAssetQuota(
  tx: Transaction,
  ownerId: string,
  additionalCount: number,
  additionalBytes: number,
  replacingStagedId?: string,
) {
  const settings = await readMediaSettings(tx, true);
  const result = await tx.execute<{ total: string; bytes: string }>(sql`
    SELECT count(*)::text AS total, coalesce(sum(bytes),0)::text AS bytes FROM (
      SELECT bytes FROM assets WHERE owner_id=${ownerId}
      UNION ALL
      SELECT coalesce(a.bytes,a.expected_bytes) AS bytes FROM market_import_assets a
      JOIN market_imports i ON i.id=a.preview_id
      WHERE i.owner_id=${ownerId} ${replacingStagedId ? sql`AND a.id<>${replacingStagedId}` : sql``}
    ) quota`);
  const quota = result.rows[0];
  if (
    Number(quota?.total ?? 0) + additionalCount > settings.maxImagesPerAccount ||
    Number(quota?.bytes ?? 0) + additionalBytes > settings.maxStorageMiBPerAccount * 1024 * 1024
  )
    throw new BusinessError(
      'CONFLICT',
      `已达到每账号 ${settings.maxImagesPerAccount} 张或 ${settings.maxStorageMiBPerAccount} MiB 的素材上限`,
    );
}
