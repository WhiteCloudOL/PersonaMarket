import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import {
  AssetJobResponseSchema,
  MarketImportPreviewResponseSchema,
  MarketImportImageListResponseSchema,
  DraftResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../tests/fixtures/auth-stack.js';
import { fixturePng } from '../tests/fixtures/image.js';
import { marketPersona } from '../tests/fixtures/market-personas.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const id = randomUUID().replaceAll('-', '');
const name = 'pm-remote-' + id;
const directory = join(root, 'data/tests/remote-images', id);
const image = 'personamarket-api:0.0.0';
await mkdir(join(directory, 'caddy'), { recursive: true, mode: 0o700 });
await mkdir(join(directory, 'config'), { recursive: true, mode: 0o700 });
await writeFile(join(directory, 'image.png'), fixturePng);
await writeFile(join(directory, 'oversized.png'), Buffer.alloc(5242881));
// 此目录只放公开测试输入；TLS 私钥目录仍由容器 UID 1000 私有持有。
await chmod(directory, 0o755);
await writeFile(
  join(directory, 'Caddyfile'),
  `{
  admin off
  auto_https disable_redirects
  skip_install_trust
}
https://images.fixture.test, https://mixed.fixture.test {
  tls internal
  handle /redirect {
    redir https://images.fixture.test/image.png 302
  }
  handle /redirect-private {
    redir https://127.0.0.1/protected.png 302
  }
  handle /loop {
    redir https://images.fixture.test/loop 302
  }
  handle {
    root * /fixture
    file_server
  }
}
`,
);
function docker(args: string[], extra: Record<string, string> = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    env: { ...process.env, ...extra },
    windowsHide: true,
    timeout: 90000,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      '受控远程图片测试的 Docker 子命令失败：' + args[0] + '（输出保留关闭，避免暴露测试凭据）',
    );
  return result.stdout.trim();
}
let stack: Awaited<ReturnType<typeof createAuthStack>> | undefined;
let network = false;
let fixture = false;
let runner = false;
try {
  stack = await createAuthStack({ isolatedStorage: true });
  const http = stack.browser();
  const username = 'remote_' + id.slice(0, 12);
  const email = username + '@fixture.invalid';
  const password = (randomUUID() + randomUUID()).replaceAll('-', '');
  assert.equal((await http.register({ username, email, password }, stack.tick)).status, 200);
  assert.equal(
    (await http.write('/api/v1/auth/login', { identifier: username, password })).status,
    200,
  );
  assert.equal((await http.context()).data.account?.emailVerified, true);
  const postgres = docker([
    'compose',
    '-f',
    'compose.yaml',
    '-f',
    'compose.dev.yaml',
    'ps',
    '-q',
    'postgres',
  ]);
  const inspect: unknown = JSON.parse(
    docker(['inspect', '--format', '{{json .NetworkSettings.Networks}}', postgres]),
  );
  if (!inspect || typeof inspect !== 'object') throw new Error('找不到共享依赖网络');
  const dependencyNetwork = Object.keys(inspect)[0];
  if (!dependencyNetwork) throw new Error('找不到共享依赖网络');
  docker([
    'run',
    '--rm',
    '--network',
    'none',
    '--user',
    '0:0',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'CHOWN',
    '--cap-add',
    'FOWNER',
    '--cap-add',
    'DAC_OVERRIDE',
    '--security-opt',
    'no-new-privileges:true',
    '--mount',
    'type=bind,src=' + directory + ',dst=/fixture',
    '--entrypoint',
    'sh',
    'personamarket-redis:8.2.7-pm.1',
    '-c',
    'chown 1000:1000 /fixture/caddy /fixture/config && chmod 0700 /fixture/caddy /fixture/config',
  ]);
  // 全球地址分类只用于完全隔离的 Docker 网络，不向公网路由或开放监听端口
  docker(['network', 'create', '--internal', '--subnet', '93.184.216.0/24', name]);
  network = true;
  docker([
    'run',
    '-d',
    '--name',
    name,
    '--network',
    name,
    '--ip',
    '93.184.216.10',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'NET_BIND_SERVICE',
    '--security-opt',
    'no-new-privileges:true',
    '--tmpfs',
    '/tmp',
    '--mount',
    'type=bind,src=' + directory + ',dst=/fixture,readonly',
    '--mount',
    'type=bind,src=' + join(directory, 'caddy') + ',dst=/data',
    '--mount',
    'type=bind,src=' + join(directory, 'config') + ',dst=/config',
    'personamarket-caddy:2.11.7-pm.2',
    'run',
    '--config',
    '/fixture/Caddyfile',
    '--adapter',
    'caddyfile',
  ]);
  fixture = true;
  const caPath = join(directory, 'root-ca.crt');
  const deadline = Date.now() + 15000;
  let ca: Buffer | undefined;
  while (!ca && Date.now() < deadline) {
    try {
      // 只导出公开根证书，不让宿主机绕过私钥目录权限。
      docker(['cp', name + ':/data/caddy/pki/authorities/local/root.crt', caPath]);
      ca = await readFile(caPath);
    } catch {
      await setTimeout(100);
    }
  }
  if (!ca) throw new Error('受控 HTTPS 证书未就绪');
  const jobs = [];
  for (const path of ['/image.png', '/redirect', '/redirect-private']) {
    const response = await http.write('/api/v1/me/assets/import-url', {
      url: 'https://images.fixture.test' + path,
    });
    assert.equal(response.status, 200);
    jobs.push(AssetJobResponseSchema.parse(await response.json()).data.id);
  }
  const sourceHash = createHash('sha256')
    .update(await readFile(join(root, 'packages/server/dist/remote-image.js')))
    .digest('hex');
  const marketSourceHash = createHash('sha256')
    .update(await readFile(join(root, 'packages/server/dist/market-import-storage.js')))
    .digest('hex');
  const previews = [];
  for (const [index, path] of ['/image.png', '/redirect-private', '/image.png'].entries()) {
    const document = marketPersona();
    const key = randomUUID();
    document.metadata.avatarKey = key;
    document.assets = [
      {
        key,
        url: 'https://images.fixture.test' + path,
        bytes: fixturePng.length,
        mimeType: 'image/png',
        sha256:
          index === 2 ? '0'.repeat(64) : createHash('sha256').update(fixturePng).digest('hex'),
      },
    ];
    const context = await http.context();
    const body = new FormData();
    body.set('file', new Blob([JSON.stringify(document)]), 'remote.persona.json');
    const response = await fetch(http.base + '/api/v1/me/market-imports/preview', {
      method: 'POST',
      body,
      headers: {
        Origin: http.origin,
        'X-CSRF-Token': context.data.csrfToken,
        Cookie: [...http.cookies].map(([key, value]) => key + '=' + value).join('; '),
      },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
    previews.push(MarketImportPreviewResponseSchema.parse(await response.json()).data);
  }
  const marketIds = previews.flatMap((preview) => preview.images.map((image) => image.id));
  const database = new URL(stack.env.DATABASE_URL);
  database.hostname = 'postgres';
  database.port = '5432';
  const redis = new URL(stack.env.REDIS_URL);
  redis.hostname = 'redis';
  redis.port = '6379';
  const code = `
    import assert from 'node:assert/strict';
    import {readFile} from 'node:fs/promises';
    import {createHash} from 'node:crypto';
    import {setTimeout} from 'node:timers/promises';
    import {createDatabase} from '@personamarket/database';
    import {createSystemQueue,createSystemWorker,dispatchOutbox,createLogger,LocalStorage,downloadPublicImage,processRemoteImage,processMarketImage} from '@personamarket/server';
    const remoteFile = new URL('remote-image.js', import.meta.resolve('@personamarket/server'));
    assert.equal(createHash('sha256').update(await readFile(remoteFile)).digest('hex'), ${JSON.stringify(sourceHash)}, '镜像与当前源码的下载实现不一致，请重建镜像');
    const marketFile = new URL('market-import-storage.js', import.meta.resolve('@personamarket/server'));
    assert.equal(createHash('sha256').update(await readFile(marketFile)).digest('hex'), ${JSON.stringify(marketSourceHash)}, '镜像与当前通用导入实现不一致，请重建镜像');
    const db=createDatabase(process.env.DATABASE_URL), logger=createLogger('remote-test','silent');
    const queue=createSystemQueue(process.env.REDIS_URL,${JSON.stringify(name)});
    const storage=new LocalStorage('/data/storage');
    const worker=createSystemWorker(db,process.env.REDIS_URL,queue.name,logger,undefined,{storage});
    try {
      await queue.waitUntilReady(); await worker.waitUntilReady();
      const ids=${JSON.stringify(jobs)};
      const deadline=Date.now()+30000;
      let rows=[];
      while(Date.now()<deadline) {
        await dispatchOutbox(db,queue,logger);
        rows=(await db.pool.query('SELECT id,status FROM asset_jobs WHERE id=ANY($1::uuid[])',[ids])).rows;
        if(rows.length===3&&rows.every(row=>['ready','failed'].includes(row.status)))break;
        await setTimeout(100);
      }
      assert.equal(rows.find(row=>row.id===ids[0])?.status,'ready');
      assert.equal(rows.find(row=>row.id===ids[1])?.status,'ready');
      assert.equal(rows.find(row=>row.id===ids[2])?.status,'failed');
      const before=(await db.pool.query('SELECT count(*)::integer AS total FROM assets')).rows[0].total;
      await processRemoteImage(db,storage,ids[0]);
      assert.equal((await db.pool.query('SELECT count(*)::integer AS total FROM assets')).rows[0].total,before);
      for(const url of ['https://mixed.fixture.test/image.png','https://images.fixture.test/loop','https://images.fixture.test/oversized.png']) await assert.rejects(downloadPublicImage(url));
      const marketIds=${JSON.stringify(marketIds)};
      let images=(await db.pool.query('SELECT id,status FROM market_import_assets WHERE id=ANY($1::uuid[])',[marketIds])).rows;
      if(images.some(row=>row.status!=='pending')) {
        const deadline=Date.now()+30000;
        while(Date.now()<deadline) {
          await dispatchOutbox(db,queue,logger);
          images=(await db.pool.query('SELECT id,status FROM market_import_assets WHERE id=ANY($1::uuid[])',[marketIds])).rows;
          if(images.length===3&&images.every(row=>['ready','failed'].includes(row.status)))break;
          await setTimeout(100);
        }
        assert.equal(images.find(row=>row.id===marketIds[0])?.status,'ready');
        assert.equal(images.find(row=>row.id===marketIds[1])?.status,'failed');
        assert.equal(images.find(row=>row.id===marketIds[2])?.status,'failed');
        const before=(await db.pool.query('SELECT sha256,storage_key FROM market_import_assets WHERE id=$1',[marketIds[0]])).rows;
        await processMarketImage(db,storage,marketIds[0],true);
        assert.deepEqual((await db.pool.query('SELECT sha256,storage_key FROM market_import_assets WHERE id=$1',[marketIds[0]])).rows,before);
        console.log('通用JSON真实HTTPS托管、重定向与哈希拒绝、重复投递幂等通过');
      }
      console.log('真实 HTTPS 下载、队列持久化、幂等、重定向、混合 DNS 和大小限制通过');
    } finally { await worker.close(); await queue.obliterate({force:true}); await queue.close(); await db.close(); }
  `;
  await mkdir(stack.env.STORAGE_ROOT, { recursive: true });
  docker(
    [
      'create',
      '--name',
      name + '-worker',
      '--user',
      `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      '--network',
      dependencyNetwork,
      '--add-host',
      'images.fixture.test:93.184.216.10',
      '--add-host',
      'mixed.fixture.test:93.184.216.10',
      '--add-host',
      'mixed.fixture.test:127.0.0.1',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--tmpfs',
      '/tmp',
      '--mount',
      'type=bind,src=' + directory + ',dst=/fixture,readonly',
      '--mount',
      'type=bind,src=' + stack.env.STORAGE_ROOT + ',dst=/data/storage',
      '-e',
      'DATABASE_URL',
      '-e',
      'REDIS_URL',
      '-e',
      'NODE_EXTRA_CA_CERTS=/fixture/root-ca.crt',
      image,
      'node',
      '--input-type=module',
      '-e',
      code,
    ],
    { DATABASE_URL: database.href, REDIS_URL: redis.href },
  );
  runner = true;
  docker(['network', 'connect', name, name + '-worker']);
  const result = docker(['start', '-a', name + '-worker']);
  assert.equal(
    docker(['inspect', '--format', '{{.State.ExitCode}}', name + '-worker']),
    '0',
    '受控下载验证失败，测试容器输出已保密',
  );
  for (const preview of previews) {
    const image = preview.images[0];
    assert.ok(image);
    assert.equal(
      (await http.write(`/api/v1/me/market-imports/${preview.id}/images/${image.id}/import-url`))
        .status,
      200,
    );
  }
  const marketResult = docker(['start', '-a', name + '-worker']);
  assert.equal(docker(['inspect', '--format', '{{.State.ExitCode}}', name + '-worker']), '0');
  for (const [index, preview] of previews.entries()) {
    const response = await http.raw(`/api/v1/me/market-imports/${preview.id}/images`);
    assert.equal(response.status, 200);
    const images = MarketImportImageListResponseSchema.parse(await response.json()).data;
    assert.equal(images[0]?.status, index === 0 ? 'ready' : 'failed');
    const saved = await http.write('/api/v1/me/market-imports/confirm', {
      previewId: preview.id,
      contentHash: preview.contentHash,
      title: '受控HTTPS导入角色',
      sourceDescription: '隔离网络真实测试文件',
      authorizationStatement: '测试作者明确授权',
      confirmed: true,
      target: { mode: 'new' },
    });
    if (index === 0) {
      assert.equal(saved.status, 200);
      const draft = DraftResponseSchema.parse(await saved.json());
      assert.equal(draft.data.draft.avatarAssetId, images[0]?.id);
      const avatar = draft.data.draft.avatarAssetId;
      assert.equal((await http.raw('/api/v1/me/assets/' + avatar)).status, 200);
      assert.equal((await stack.browser().raw('/api/v1/public/assets/' + avatar)).status, 404);
    } else {
      assert.equal(saved.status, 409);
      assert.equal(
        (await http.write('/api/v1/me/market-imports/' + preview.id, undefined, 'DELETE')).status,
        200,
      );
    }
  }
  await writeFile(join(directory, 'image.png'), Buffer.from('origin changed after import'));
  for (const jobId of jobs.slice(0, 2)) {
    const job = AssetJobResponseSchema.parse(
      await (await http.raw('/api/v1/me/asset-jobs/' + jobId)).json(),
    );
    assert.equal(job.data.status, 'ready');
    const response = await http.raw('/api/v1/me/assets/' + job.data.assetId);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    const storedBytes = Buffer.from(await response.arrayBuffer());
    assert.equal(storedBytes.includes(Buffer.from('private metadata')), false);
    const stored: { rows: { sha256: string }[] } = await stack.owner.pool.query<{ sha256: string }>(
      'SELECT sha256 FROM assets WHERE id=$1',
      [job.data.assetId],
    );
    assert.equal(createHash('sha256').update(storedBytes).digest('hex'), stored.rows[0]?.sha256);
    assert.equal(
      (await stack.browser().raw('/api/v1/public/assets/' + job.data.assetId)).status,
      404,
    );
  }
  await mkdir(join(root, '.development/evidence'), { recursive: true });
  await writeFile(
    join(root, '.development/evidence/remote-images.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        fixtureNetwork: 'internal, no published ports',
        sourceHash,
        marketSourceHash,
        image,
        imageId: docker(['image', 'inspect', '--format', '{{.Id}}', image]),
        caSha256: createHash('sha256').update(ca).digest('hex'),
        result: 'passed',
        cases: [
          'real TLS + trusted fixture CA',
          'actual pinned public peer',
          'Outbox + BullMQ + database + private WebP',
          'redirect success',
          'private redirect rejected',
          'mixed DNS rejected',
          'redirect limit',
          'byte limit',
          'duplicate delivery idempotency',
          'unreviewed images not public',
          'origin changed without altering stored snapshot',
          'market JSON explicit remote image consent + real TLS + atomic draft transfer',
          'market image private redirect + source SHA mismatch rejected',
          'market image duplicate delivery idempotency',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(result);
  console.log(marketResult);
} finally {
  if (runner) docker(['rm', '-f', name + '-worker']);
  if (fixture) docker(['rm', '-f', name]);
  if (network) docker(['network', 'rm', name]);
  await stack?.close();
}
