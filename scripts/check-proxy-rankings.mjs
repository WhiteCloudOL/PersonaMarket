import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const chunks = [];
let bytes = 0;
for await (const chunk of process.stdin) {
  bytes += chunk.length;
  assert.ok(bytes <= 2048, '隔离代理测试输入超限');
  chunks.push(chunk);
}
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
assert.match(input.project, /^pm-fresh-[a-f0-9]{32}$/);
assert.match(input.apiContainer, /^[a-f0-9]{64}$/);
const origin = new URL(input.origin);
assert.equal(origin.hostname, '127.0.0.1');
assert.equal(origin.protocol, 'http:');
assert.ok(Number(origin.port) > 1024 && !['3000', '3001', '8080'].includes(origin.port));
function docker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 65536,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
assert.equal(
  docker([
    'inspect',
    '--format',
    '{{ index .Config.Labels "com.docker.compose.project" }}',
    input.apiContainer,
  ]),
  input.project,
);
assert.equal(
  docker([
    'inspect',
    '--format',
    '{{ index .Config.Labels "com.docker.compose.service" }}',
    input.apiContainer,
  ]),
  'api',
);
function execute(code) {
  return docker(['exec', input.apiContainer, 'node', '--input-type=module', '-e', code]);
}
function counts(scope) {
  assert.ok(['public-rankings', 'public-sitemap'].includes(scope));
  return JSON.parse(
    execute(`
    import { createClient } from 'redis';
    const client = createClient({url: process.env.REDIS_URL, socket: {connectTimeout: 2000, reconnectStrategy: false}});
    client.on('error', () => undefined);
    await client.connect();
    try {
      let cursor = '0';
      const result = [];
      do {
        const page = await client.scan(cursor, {MATCH: ${JSON.stringify('pm:auth-rate:/personamarket:' + scope + ':*')}, COUNT: 100});
        cursor = page.cursor;
        for (const key of page.keys) result.push(Number(await client.get(key)));
        if (result.length > 10) throw new Error('隔离榜单限流状态超出预期');
      } while (cursor !== '0');
      process.stdout.write(JSON.stringify(result.sort((a,b) => a-b)));
    } finally {client.destroy();}
  `),
  );
}
async function hostRead(address, path, expected) {
  const response = await fetch(new URL(path, origin), {
    headers: { 'x-forwarded-for': address },
    signal: AbortSignal.timeout(10000),
  });
  if (path.startsWith('/api/')) {
    assert.ok([200, 503].includes(response.status));
    await response.arrayBuffer();
  } else {
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(expected));
  }
}
const cases = [
  {
    scope: 'public-rankings',
    page: '/rankings?kind=updated',
    api: '/api/v1/rankings?kind=updated&window=all',
    expected: '人设排行榜',
  },
  {
    scope: 'public-sitemap',
    page: '/sitemap.xml',
    api: '/api/v1/public/sitemap/index',
    expected: 'sitemapindex',
  },
];
for (const item of cases) {
  assert.deepEqual(counts(item.scope), [], '新隔离服务的公开读取计数应为空');
  await hostRead('203.0.113.10', item.page, item.expected);
  assert.deepEqual(counts(item.scope), [1]);
  await hostRead('198.51.100.20', item.page, item.expected);
  assert.deepEqual(counts(item.scope), [2], '更换伪造转发头不能更换真实访客的配额');
  assert.equal(
    execute(`
  const response = await fetch(${JSON.stringify('http://caddy:8080' + item.page)}, {
    headers: {'x-forwarded-for': '203.0.113.30'}, signal: AbortSignal.timeout(10000)
  });
  const html = await response.text();
  if (response.status !== 200 || !html.includes(${JSON.stringify(item.expected)})) process.exit(1);
  process.stdout.write('passed');
`),
    'passed',
  );
  assert.deepEqual(counts(item.scope), [1, 2], '来自不同真实网络地址的公开读取必须使用独立配额');
  await hostRead('203.0.113.40', item.api);
  assert.deepEqual(counts(item.scope), [1, 3], '同一真实访客的Web和直接API请求必须共用限流');
}
const directory = join(process.cwd(), '.development/evidence');
mkdirSync(directory, { recursive: true });
writeFileSync(
  join(directory, 'rankings-proxy.json'),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      isolatedProject: input.project,
      scopes: cases.map((item) => item.scope),
      spoofedForwardingHeadersIgnored: true,
      distinctVisitorsHaveIndependentQuota: true,
      ssrAndApiShareQuota: true,
    },
    null,
    2,
  ) + '\n',
);
console.log('真实Caddy→Web→API榜单与地图：伪造代理头拒绝、不同访客独立限流与同访客API配额一致通过');
