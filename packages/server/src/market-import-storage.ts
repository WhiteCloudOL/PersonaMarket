import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  assets,
  marketImports,
  marketImportAssets,
  users,
  type Database,
} from '@personamarket/database';
import { BusinessError } from './errors.js';
import { normalizeImage } from './images.js';
import { assertAssetQuota } from './asset-quota.js';
import type { Storage } from './storage.js';
import { downloadPublicImage } from './remote-image.js';
import {
  readMediaSettings,
  assertMediaImage,
  assertMediaRemote,
  type MediaImageSource,
} from './media-settings.js';
import {
  assertOrdinaryRequestAllowed,
  assertOrdinaryWriteAllowed,
  type StorageExecution,
} from './system-settings.js';

export async function deleteStoredFile(storage: Storage, key: string) {
  try {
    await storage.delete(key);
  } catch (cause) {
    if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause;
  }
}

/** 图片解码在事务外；仅最终有界本地写入与状态提交持有预览锁，避免过期清理与写文件竞态 */
export async function stageMarketImage(
  database: Database,
  storage: Storage,
  previewId: string,
  packageKey: string,
  bytes: Uint8Array,
  source: MediaImageSource = { kind: 'local' },
  execution: StorageExecution = 'request',
) {
  const [expected] = await database.db
    .select()
    .from(marketImportAssets)
    .where(
      and(
        eq(marketImportAssets.previewId, previewId),
        eq(marketImportAssets.packageKey, packageKey),
      ),
    );
  if (!expected) throw new BusinessError('NOT_FOUND', '导入图片不存在或预览已过期');
  if (execution === 'request' && expected.status !== 'ready')
    await assertOrdinaryRequestAllowed(database);
  assertMediaImage(await readMediaSettings(database.db), bytes.byteLength, source);
  if (
    bytes.byteLength !== expected.expectedBytes ||
    createHash('sha256').update(bytes).digest('hex') !== expected.expectedHash
  )
    throw new BusinessError('INVALID_INPUT', '源图片大小或SHA-256与清单不一致');
  const normalized = await normalizeImage(bytes, expected.expectedMime);
  await database.db.transaction(async (tx) => {
    const [owner] = await tx.select().from(marketImports).where(eq(marketImports.id, previewId));
    if (!owner) throw new BusinessError('CONFLICT', '导入预览已过期');
    const [account] = await tx
      .select({ status: users.status, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, owner.ownerId))
      .for('update');
    if (account?.status !== 'active')
      throw new BusinessError('FORBIDDEN', '账号状态不允许导入图片');
    if (source.kind === 'remote' && !account.emailVerifiedAt)
      throw new BusinessError('FORBIDDEN', '请先验证邮箱后再导入在线图片');
    if (owner.expiresAt.getTime() <= Date.now() || owner.consumedAt || owner.state === 'failed')
      throw new BusinessError('CONFLICT', '导入预览已过期或已使用');
    const [completed] = await tx
      .select({ status: marketImportAssets.status })
      .from(marketImportAssets)
      .where(eq(marketImportAssets.id, expected.id));
    // 只读核对已托管图片，不触碰其既有文件或续期预览。
    if (completed?.status === 'ready') return;
    if (execution === 'request') await assertOrdinaryWriteAllowed(tx);
    const [preview] = await tx
      .select()
      .from(marketImports)
      .where(eq(marketImports.id, previewId))
      .for('update');
    if (
      !preview ||
      preview.expiresAt.getTime() <= Date.now() ||
      preview.consumedAt ||
      preview.state === 'failed'
    )
      throw new BusinessError('CONFLICT', '导入预览已过期或已使用');
    const [current] = await tx
      .select()
      .from(marketImportAssets)
      .where(eq(marketImportAssets.id, expected.id))
      .for('update');
    if (!current) throw new BusinessError('CONFLICT', '导入图片已变化');
    if (current.status === 'ready') return;
    assertMediaImage(await readMediaSettings(tx, true), bytes.byteLength, source);
    await assertAssetQuota(tx, owner.ownerId, 1, normalized.data.length, current.id);
    const [registered] = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.storageKey, current.storageKey));
    if (registered) throw new Error('STAGED_STORAGE_ALREADY_REGISTERED');
    // 只清除此行预先登记的临时键，恢复上次进程中断的部分文件；不读取包内路径
    await deleteStoredFile(storage, current.storageKey);
    await storage.put(current.storageKey, normalized.data);
    await tx
      .update(marketImportAssets)
      .set({
        status: 'ready',
        bytes: normalized.data.length,
        width: normalized.width,
        height: normalized.height,
        sha256: createHash('sha256').update(normalized.data).digest('hex'),
      })
      .where(eq(marketImportAssets.id, current.id));
  });
}

export async function processMarketImage(
  database: Database,
  storage: Storage,
  assetId: string,
  lastAttempt = false,
) {
  // 与UUID列和受控重试共用规范化业务锁，合法大写ID不能形成第二把锁。
  const lockKey = assetId.toLowerCase();
  const connection = await database.pool.connect();
  let locked = false;
  try {
    const claim = await connection.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',
      [lockKey],
    );
    locked = claim.rows[0]?.locked === true;
    if (!locked) throw new Error('MARKET_IMAGE_BUSY');
    const [row] = await database.db
      .select({ image: marketImportAssets, preview: marketImports })
      .from(marketImportAssets)
      .innerJoin(marketImports, eq(marketImports.id, marketImportAssets.previewId))
      .where(eq(marketImportAssets.id, assetId));
    if (
      !row ||
      row.image.status === 'ready' ||
      row.image.status === 'failed' ||
      row.preview.state !== 'ready' ||
      row.preview.consumedAt ||
      row.preview.expiresAt.getTime() <= Date.now()
    )
      return;
    if (!row.image.sourceUrl) throw new Error('MARKET_IMAGE_URL_MISSING');
    await database.db
      .update(marketImportAssets)
      .set({ status: 'processing' })
      .where(eq(marketImportAssets.id, assetId));
    try {
      const settings = await readMediaSettings(database.db);
      assertMediaRemote(settings, row.image.sourceUrl);
      const visited = [row.image.sourceUrl];
      const bytes = await downloadPublicImage(row.image.sourceUrl, {
        maxBytes: settings.maxImageKiB * 1024,
        checkTarget: async (target) => {
          assertMediaRemote(await readMediaSettings(database.db), target.href);
          visited.push(target.href);
        },
      });
      await stageMarketImage(
        database,
        storage,
        row.preview.id,
        row.image.packageKey,
        bytes,
        { kind: 'remote', urls: visited },
        'background',
      );
    } catch (cause) {
      const terminal = cause instanceof BusinessError || lastAttempt;
      await database.db
        .update(marketImportAssets)
        .set({ status: terminal ? 'failed' : 'queued' })
        .where(and(eq(marketImportAssets.id, assetId), sql`${marketImportAssets.status}<>'ready'`));
      if (!(cause instanceof BusinessError)) throw cause;
    }
  } finally {
    try {
      if (locked)
        await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey]);
    } finally {
      connection.release();
    }
  }
}

/** 与预览/确认同锁顺序中的预览锁互斥；删除记录与可靠文件清理事件同事务 */
export async function pruneMarketImports(database: Database) {
  return database.db.transaction(async (tx) => {
    const result = await tx.execute<{ total: number }>(sql`
      WITH expired AS (
        SELECT id FROM market_imports WHERE expires_at<=now()
        ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT 20
      ), cleanup AS (
        INSERT INTO outbox_events(topic,payload)
        SELECT 'storage.cleanup',jsonb_build_object('schemaVersion',1,'storageKey',a.storage_key)
        FROM market_import_assets a WHERE a.preview_id IN (SELECT id FROM expired)
        RETURNING id
      ), removed AS (
        DELETE FROM market_imports WHERE id IN (SELECT id FROM expired) RETURNING id
      ) SELECT count(*)::integer AS total FROM removed`);
    return result.rows[0]?.total ?? 0;
  });
}

export async function cleanupStoredFile(database: Database, storage: Storage, key: string) {
  const result = await database.pool.query(
    'SELECT 1 FROM assets WHERE storage_key=$1 UNION ALL SELECT 1 FROM market_import_assets WHERE storage_key=$1 LIMIT 1',
    [key],
  );
  if (!result.rowCount) await deleteStoredFile(storage, key);
}
