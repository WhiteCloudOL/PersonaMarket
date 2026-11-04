import { randomUUID, createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { assets, assetJobs, users, type Database } from '@personamarket/database';
import { BusinessError } from './errors.js';
import { normalizeImage } from './images.js';
import { downloadPublicImage } from './remote-image.js';
import type { Storage } from './storage.js';
import { assertAssetQuota } from './asset-quota.js';
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

/** 配额与插入在用户锁内执行，避免并发上传绕过总大小限制。 */
export async function storeImage(
  database: Database,
  storage: Storage,
  ownerId: string,
  purpose: 'content' | 'evidence' | 'avatar' | 'persona-avatar',
  bytes: Uint8Array,
  sourceUrl?: string,
  fixedId?: string,
  visitedSources: readonly string[] = [],
  execution: StorageExecution = 'request',
) {
  if (execution === 'request') await assertOrdinaryRequestAllowed(database);
  const origin: MediaImageSource = sourceUrl
    ? { kind: 'remote', urls: [sourceUrl, ...visitedSources] }
    : { kind: purpose === 'persona-avatar' ? 'persona-avatar' : 'local' };
  assertMediaImage(await readMediaSettings(database.db), bytes.byteLength, origin);
  const normalized = await normalizeImage(bytes, undefined, origin.kind === 'persona-avatar');
  const storageKey = randomUUID().replaceAll('-', '') + '.webp';
  await storage.put(storageKey, normalized.data);
  try {
    return await database.db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ status: users.status, emailVerifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.id, ownerId))
        .for('update');
      if (owner?.status !== 'active')
        throw new BusinessError('FORBIDDEN', '账号状态不允许上传素材');
      if (origin.kind === 'remote' && !owner.emailVerifiedAt)
        throw new BusinessError('FORBIDDEN', '请先验证邮箱后再导入在线图片');
      if (execution === 'request') await assertOrdinaryWriteAllowed(tx);
      assertMediaImage(await readMediaSettings(tx, true), bytes.byteLength, origin);
      await assertAssetQuota(tx, ownerId, 1, normalized.data.length);
      const [row] = await tx
        .insert(assets)
        .values({
          ...(fixedId ? { id: fixedId } : {}),
          ownerId,
          purpose: purpose === 'persona-avatar' ? 'content' : purpose,
          storageKey,
          mime: 'image/webp',
          width: normalized.width,
          height: normalized.height,
          bytes: normalized.data.length,
          sha256: createHash('sha256').update(normalized.data).digest('hex'),
          ...(sourceUrl ? { sourceUrl } : {}),
        })
        .returning();
      if (!row) throw new Error('ASSET_INSERT_FAILED');
      return row;
    });
  } catch (cause) {
    await storage.delete(storageKey).catch(() => undefined);
    throw cause;
  }
}
export async function processRemoteImage(
  database: Database,
  storage: Storage,
  jobId: string,
  lastAttempt = false,
) {
  // 会话级 advisory lock 不开启长事务；进程崩溃时连接关闭自动释放，跨队列重复交付仍安全。
  // PostgreSQL UUID不区分大小写，文本锁键必须与其业务身份一致。
  const lockKey = jobId.toLowerCase();
  const connection = await database.pool.connect();
  let locked = false;
  try {
    const result = await connection.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',
      [lockKey],
    );
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new Error('IMAGE_JOB_BUSY');
    const [job] = await database.db.select().from(assetJobs).where(eq(assetJobs.id, jobId));
    if (!job || job.status === 'ready' || job.status === 'failed') return;
    await database.db
      .update(assetJobs)
      .set({ status: 'processing' })
      .where(eq(assetJobs.id, jobId));
    try {
      let [asset] = await database.db
        .select()
        .from(assets)
        .where(and(eq(assets.id, job.id), eq(assets.ownerId, job.ownerId)));
      if (!asset) {
        const settings = await readMediaSettings(database.db);
        assertMediaRemote(settings, job.sourceUrl);
        const visited: string[] = [];
        const bytes = await downloadPublicImage(job.sourceUrl, {
          maxBytes: settings.maxImageKiB * 1024,
          checkTarget: async (target) => {
            assertMediaRemote(await readMediaSettings(database.db), target.href);
            visited.push(target.href);
          },
        });
        asset = await storeImage(
          database,
          storage,
          job.ownerId,
          'content',
          bytes,
          job.sourceUrl,
          job.id,
          visited,
          'background',
        );
      }
      await database.db
        .update(assetJobs)
        .set({ status: 'ready', assetId: asset.id, errorCode: null })
        .where(eq(assetJobs.id, jobId));
    } catch (cause) {
      const terminal = cause instanceof BusinessError || lastAttempt;
      await database.db
        .update(assetJobs)
        .set({
          status: terminal ? 'failed' : 'pending',
          errorCode:
            cause instanceof BusinessError && cause.code === 'FORBIDDEN'
              ? 'IMAGE_IMPORT_NOT_ALLOWED'
              : 'IMAGE_IMPORT_FAILED',
        })
        .where(eq(assetJobs.id, jobId));
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
