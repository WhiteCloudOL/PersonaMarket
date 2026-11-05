import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { environment, root } from './runtime.mjs';

// A separate Compose project with fresh bind directories; the running project is untouched.
const journal = JSON.parse(
  readFileSync(join(root, 'packages/database/migrations/meta/_journal.json'), 'utf8'),
);
const migrationCount = journal.entries.length;
const id = randomUUID().replaceAll('-', '');
const name = `pm-fresh-${id}`;
const directory = join(root, 'data/tests/compose', id);
for (const part of ['postgres', 'redis', 'storage', 'caddy/data', 'caddy/config', 'mailpit'])
  mkdirSync(join(directory, part), { recursive: true, mode: 0o700 });
const bind = (part, target) => `${join(directory, part).replaceAll('\\', '/')}:${target}`;
const config = (part, target) => `${join(root, part).replaceAll('\\', '/')}:${target}:ro`;
const readinessProbe = join(directory, 'check-tcp-readiness.sh');
writeFileSync(
  readinessProbe,
  '#!/bin/sh\nset -eu\npg_isready -U personamarket_owner -d personamarket >/dev/null\nif pg_isready -h 127.0.0.1 -U personamarket_owner -d personamarket >/dev/null; then\n  echo "TCP became ready during initialization" >&2\n  exit 1\nfi\nprintf passed > "$PGDATA/.pm-readiness-probe"\n',
);
const overrides = {
  'data-init': {
    volumes: [
      bind('postgres', '/postgres'),
      bind('redis', '/data'),
      bind('storage', '/storage'),
      bind('caddy/data', '/caddy-data'),
      bind('caddy/config', '/caddy-config'),
      bind('mailpit', '/mailpit'),
    ],
  },
  mailpit: { volumes: [bind('mailpit', '/data')], ports: [] },
  postgres: {
    volumes: [
      bind('postgres', '/var/lib/postgresql'),
      config('infra/postgres/init-app.sh', '/docker-entrypoint-initdb.d/10-app.sh'),
      `${readinessProbe.replaceAll('\\', '/')}:/docker-entrypoint-initdb.d/90-readiness-probe.sh:ro`,
    ],
    ports: [],
  },
  redis: {
    volumes: [
      bind('redis', '/data'),
      config('infra/redis/redis.conf', '/usr/local/etc/redis/redis.conf'),
    ],
    ports: [],
  },
  api: { volumes: [bind('storage', '/data/storage')] },
  worker: { volumes: [bind('storage', '/data/storage')] },
  caddy: {
    volumes: [
      config('infra/caddy/Caddyfile', '/etc/caddy/Caddyfile'),
      bind('caddy/data', '/data'),
      bind('caddy/config', '/config'),
    ],
    ports: ['127.0.0.1::8080'],
  },
};
const override = join(directory, 'compose.yaml');
writeFileSync(
  override,
  'services:\n' +
    Object.entries(overrides)
      .map(
        ([service, properties]) =>
          `  ${service}:\n` +
          Object.entries(properties)
            .map(([key, value]) => `    ${key}: !override ${JSON.stringify(value)}\n`)
            .join(''),
      )
      .join(''),
);
function compose(args, input) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-p',
      name,
      '-f',
      'compose.yaml',
      '-f',
      'compose.dev.yaml',
      '-f',
      override,
      ...args,
    ],
    {
      cwd: root,
      env: environment(),
      encoding: 'utf8',
      timeout: 240_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      input,
    },
  );
  if (result.status !== 0)
    throw new Error(`隔离 Compose ${args[0]} 失败：${result.stderr.slice(-2000)}`);
  return result.stdout.trim();
}
try {
  console.log('隔离空目录：初始化 PostgreSQL / Redis、迁移和完整服务');
  compose(['up', '-d', '--wait']);
  const origin = () => `http://127.0.0.1:${compose(['port', 'caddy', '8080']).split(':').at(-1)}`;
  const read = async () => {
    const deadline = Date.now() + 15_000;
    while (true) {
      try {
        const response = await fetch(origin() + '/api/v1/public/config', {
          signal: AbortSignal.timeout(3000),
        });
        assert.equal(response.status, 200);
        return await response.json();
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await setTimeout(200);
      }
    }
  };
  const before = await read();
  const status = JSON.parse('[' + compose(['ps', '--format', 'json']).split('\n').join(',') + ']');
  assert.ok(status.length >= 6);
  for (const service of status) assert.equal(service.LocalVolumes, '0');
  assert.equal(
    compose(['exec', '-T', 'api', 'node', '-p', 'process.version+":"+process.getuid()']),
    'v' + readFileSync(join(root, '.node-version'), 'utf8').trim() + ':1000',
  );
  assert.equal(compose(['exec', '-T', 'web', 'node', '-p', 'process.getuid()']), '1000');
  assert.equal(
    compose(['exec', '-T', 'postgres', 'sh', '-c', 'cat "$PGDATA/.pm-readiness-probe"']),
    'passed',
  );
  assert.equal(
    compose([
      'exec',
      '-T',
      'api',
      'node',
      '--input-type=module',
      '-e',
      "import {hashPassword,verifyPassword} from '@personamarket/server';const p='container-native-binding-check';if(!await verifyPassword(await hashPassword(p),p))process.exit(1);console.log('argon2id-ok')",
    ]),
    'argon2id-ok',
  );
  const maintenanceAccount = {
    username: 'container_admin',
    email: 'container-admin@fixture.invalid',
    password: (randomUUID() + randomUUID()).replaceAll('-', ''),
  };
  assert.match(
    compose(
      ['--profile', 'maintenance', 'run', '--rm', '--no-deps', '-T', 'admin'],
      JSON.stringify(maintenanceAccount),
    ),
    /可在账号与安全中自愿绑定 MFA/,
  );
  if (!process.env.npm_execpath) throw new Error('请通过pnpm运行完整容器验收');
  const uploads = spawnSync(
    process.execPath,
    [process.env.npm_execpath, 'exec', 'tsx', 'scripts/check-proxy-uploads.ts'],
    {
      cwd: root,
      env: environment(),
      windowsHide: true,
      encoding: 'utf8',
      timeout: 120000,
      input: JSON.stringify({
        origin: origin(),
        publicOrigin: compose(['exec', '-T', 'api', 'node', '-p', 'process.env.PUBLIC_ORIGIN']),
        project: name,
        account: maintenanceAccount,
      }),
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (uploads.status !== 0) throw new Error('代理上传验收失败：' + uploads.stderr.slice(-3000));
  console.log(uploads.stdout.trim());
  const rankings = spawnSync(process.execPath, ['scripts/check-proxy-rankings.mjs'], {
    cwd: root,
    env: environment(),
    windowsHide: true,
    encoding: 'utf8',
    timeout: 60000,
    input: JSON.stringify({
      origin: origin(),
      project: name,
      apiContainer: compose(['ps', '-q', 'api']),
    }),
    maxBuffer: 65536,
  });
  if (rankings.status !== 0) throw new Error('排行榜代理验收失败：' + rankings.stderr.slice(-2000));
  console.log(rankings.stdout.trim());
  assert.match(compose(['exec', '-T', 'caddy', 'caddy', 'version']), /v2\.11\.7/);
  assert.match(
    compose([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'personamarket_owner',
      '-d',
      'personamarket',
      '-tAc',
      'SELECT count(*) FROM drizzle.__drizzle_migrations',
    ]),
    new RegExp(`^${migrationCount}$`),
  );
  console.log('隔离空目录：正常停止并重新启动，检查配置与持久化');
  compose(['stop']);
  compose(['up', '-d', '--wait']);
  assert.deepEqual(await read(), before);
  assert.equal((await fetch(origin())).status, 200);
  mkdirSync(join(root, '.development/evidence'), { recursive: true });
  writeFileSync(
    join(root, '.development/evidence/compose-fresh.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        freshInitialization: 'passed',
        initializationSocketDoesNotImplyTcpReadiness: 'passed',
        migrationCount,
        health: 'passed',
        restartPersistence: 'passed',
        rankingProxyAndVisitorQuotas: 'passed',
        sitemapProxyAndVisitorQuotas: 'passed',
        anonymousOrNamedVolumes: 0,
        directory,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('空 data 目录完整启动、迁移、健康检查与重启持久化通过');
} finally {
  // Remove only this generated project's containers/network; retain its data and all existing volumes.
  compose(['down']);
}
