import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:http2';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { root } from './runtime.mjs';

const directory = join(root, 'data/tests/proxy', randomUUID());
const runtimeDirectory = join(directory, 'runtime');
const name = 'pm-tls-' + randomUUID();
mkdirSync(directory, { recursive: true, mode: 0o700 });
mkdirSync(runtimeDirectory, { mode: 0o700 });
writeFileSync(
  join(runtimeDirectory, 'Caddyfile'),
  '{\n auto_https disable_redirects\n}\nhttps://localhost:8443 {\n tls internal\n respond "tls-check"\n}\n',
);
function docker(args) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error('TLS 隔离容器操作失败：' + result.stderr.slice(-1000));
  return result.stdout.trim();
}
const image = 'personamarket-caddy:2.11.7-pm.2';
docker([
  'run',
  '--rm',
  '--network',
  'none',
  '--mount',
  `type=bind,src=${runtimeDirectory},dst=/work`,
  'alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a',
  'chown',
  '-R',
  '1000:1000',
  '/work',
]);
try {
  docker([
    'run',
    '-d',
    '--name',
    name,
    '--mount',
    `type=bind,src=${runtimeDirectory},dst=/work`,
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '-e',
    'XDG_DATA_HOME=/work/data',
    '-e',
    'XDG_CONFIG_HOME=/work/config',
    '-p',
    '127.0.0.1::8443',
    image,
    'run',
    '--config',
    '/work/Caddyfile',
    '--adapter',
    'caddyfile',
  ]);
  const port = docker(['port', name, '8443/tcp']).split(':').at(-1);
  const certificate = join(directory, 'root.crt');
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      docker(['cp', name + ':/work/data/caddy/pki/authorities/local/root.crt', certificate]);
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await setTimeout(200);
    }
  }
  const session = connect(`https://127.0.0.1:${port}`, {
    ca: readFileSync(certificate),
    servername: 'localhost',
  });
  try {
    const content = await new Promise((resolve, reject) => {
      session.setTimeout(10_000, () => reject(new Error('TLS/HTTP2 超时')));
      session.once('error', reject);
      session.once('connect', () => {
        assert.equal(session.alpnProtocol, 'h2');
        const stream = session.request({ ':path': '/' });
        let text = '';
        stream.setEncoding('utf8');
        stream.once('response', (headers) => assert.equal(headers[':status'], 200));
        stream.on('data', (value) => {
          text += value;
        });
        stream.once('end', () => resolve(text));
        stream.once('error', reject);
        stream.end();
      });
    });
    assert.equal(content, 'tls-check');
  } finally {
    session.destroy();
  }
  mkdirSync(join(root, '.development/evidence'), { recursive: true });
  writeFileSync(
    join(root, '.development/evidence/proxy-tls.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        image,
        uid: 1000,
        verifiedCertificate: true,
        tlsAndHttp2: 'passed',
        publicDomainAcme: 'not tested',
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Caddy 非 root TLS、证书链校验与 HTTP/2 通过');
} finally {
  docker(['rm', '-f', name]);
}
