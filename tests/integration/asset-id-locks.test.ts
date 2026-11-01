import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '@personamarket/database';
import {
  createAdministrator,
  LocalStorage,
  processMarketImage,
  processRemoteImage,
  storeImage,
} from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { fixturePng } from '../fixtures/image.js';
import { marketPersona } from '../fixtures/market-personas.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

async function imageOwner() {
  const username = 'lock_' + randomUUID().replaceAll('-', '').slice(0, 12);
  await createAdministrator(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password: 'Owned image lock fixture passphrase 2026',
  });
  const owner = (
    await stack.owner.pool.query<{ id: string }>('SELECT id FROM users WHERE username=$1', [
      username,
    ])
  ).rows[0];
  if (!owner) throw Error('缺少隔离账号');
  return owner;
}

async function expectReleased(id: string) {
  const connection = await stack.owner.pool.connect();
  try {
    const result = await connection.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',
      [id],
    );
    try {
      expect(result.rows).toEqual([{ locked: true }]);
    } finally {
      if (result.rows[0]?.locked)
        await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [id]);
    }
  } finally {
    connection.release();
  }
}

it.each(['canonical', 'uppercase'] as const)(
  '图片消费者%s UUID必须遵守同一业务锁，不能越过正在受控处理的任务',
  async (variant) => {
    const owner = await imageOwner();
    const jobId = 'a' + randomUUID().slice(1),
      database = createDatabase(stack.env.DATABASE_URL),
      storage = new LocalStorage(stack.env.STORAGE_ROOT);
    let storageKey: string | undefined;
    try {
      // 真实规范化图片和应用角色入库；已有固定ID素材使本测试无需外网/伪造下载响应
      const asset = await storeImage(
        database,
        storage,
        owner.id,
        'content',
        fixturePng,
        undefined,
        jobId,
      );
      storageKey = asset.storageKey;
      await stack.owner.pool.query(
        "INSERT INTO asset_jobs(id,owner_id,source_url,status) VALUES($1,$2,'https://private-lock-fixture.invalid/image.png','pending')",
        [jobId, owner.id],
      );
      const lock = await stack.owner.pool.connect();
      try {
        await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [jobId]);
        let outcome = 'completed';
        try {
          await processRemoteImage(
            database,
            storage,
            variant === 'uppercase' ? jobId.toUpperCase() : jobId,
          );
        } catch (cause) {
          if (!(cause instanceof Error) || cause.message !== 'IMAGE_JOB_BUSY') throw cause;
          outcome = cause.message;
        }
        const rows = (
          await stack.owner.pool.query('SELECT status FROM asset_jobs WHERE id=$1', [jobId])
        ).rows;
        expect({ outcome, rows }).toEqual({
          outcome: 'IMAGE_JOB_BUSY',
          rows: [{ status: 'pending' }],
        });
      } finally {
        await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [jobId]);
        lock.release();
      }
      await processRemoteImage(
        database,
        storage,
        variant === 'uppercase' ? jobId.toUpperCase() : jobId,
      );
      await expectReleased(jobId);
      expect(
        (
          await stack.owner.pool.query('SELECT status,asset_id FROM asset_jobs WHERE id=$1', [
            jobId,
          ])
        ).rows,
      ).toEqual([{ status: 'ready', asset_id: jobId }]);
      expect(
        (await stack.owner.pool.query('SELECT count(*) FROM assets WHERE id=$1', [jobId])).rows,
      ).toEqual([{ count: '1' }]);
    } finally {
      // 仅删除本用例真实storeImage返回的单一随机键，不递归删除目录或其他夹具
      if (storageKey) await storage.delete(storageKey);
      await database.close();
    }
  },
);

it.each(['canonical', 'uppercase'] as const)(
  '导入包图片消费者%s UUID遵守同一锁，持锁期间不下载或改变业务状态',
  async (variant) => {
    const owner = await imageOwner();
    const assetId = 'a' + randomUUID().slice(1),
      previewId = randomUUID(),
      packageKey = randomUUID(),
      database = createDatabase(stack.env.DATABASE_URL),
      storage = new LocalStorage(stack.env.STORAGE_ROOT);
    const document = marketPersona();
    const hash = createHash('sha256').update(fixturePng).digest('hex');
    const sourceUrl = 'https://127.0.0.1/image-lock-fixture.png';
    document.assets.push({
      key: packageKey,
      url: sourceUrl,
      mimeType: 'image/png',
      bytes: fixturePng.length,
      sha256: hash,
    });
    try {
      // 独立库内的合法非终态消费者夹具；解锁后用真实SSRF校验终结，不访问外网
      await stack.owner.pool.query(
        "INSERT INTO market_imports(id,owner_id,format,state,filename,content_hash,document,expires_at) VALUES($1,$2,'market-json','ready','image-lock.persona.json',$3,$4,now()+interval '1 hour')",
        [
          previewId,
          owner.id,
          createHash('sha256').update(JSON.stringify(document)).digest('hex'),
          document,
        ],
      );
      await stack.owner.pool.query(
        "INSERT INTO market_import_assets(id,preview_id,package_key,storage_key,source_url,expected_mime,expected_bytes,expected_hash,status) VALUES($1,$2,$3,$4,$5,'image/png',$6,$7,'queued')",
        [
          assetId,
          previewId,
          packageKey,
          randomUUID().replaceAll('-', '') + '.webp',
          sourceUrl,
          fixturePng.length,
          hash,
        ],
      );
      const lock = await stack.owner.pool.connect();
      try {
        await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [assetId]);
        let outcome = 'completed';
        try {
          await processMarketImage(
            database,
            storage,
            variant === 'uppercase' ? assetId.toUpperCase() : assetId,
          );
        } catch (cause) {
          if (!(cause instanceof Error) || cause.message !== 'MARKET_IMAGE_BUSY') throw cause;
          outcome = cause.message;
        }
        const rows = (
          await stack.owner.pool.query('SELECT status FROM market_import_assets WHERE id=$1', [
            assetId,
          ])
        ).rows;
        expect({ outcome, rows }).toEqual({
          outcome: 'MARKET_IMAGE_BUSY',
          rows: [{ status: 'queued' }],
        });
      } finally {
        await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [assetId]);
        lock.release();
      }
      await processMarketImage(
        database,
        storage,
        variant === 'uppercase' ? assetId.toUpperCase() : assetId,
      );
      await expectReleased(assetId);
      expect(
        (
          await stack.owner.pool.query('SELECT status FROM market_import_assets WHERE id=$1', [
            assetId,
          ])
        ).rows,
      ).toEqual([{ status: 'failed' }]);
      expect((await stack.owner.pool.query('SELECT count(*) FROM assets')).rows).toEqual([
        { count: '0' },
      ]);
    } finally {
      await database.close();
    }
  },
);
