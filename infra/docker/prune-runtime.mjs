import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync, gunzipSync, deflateRawSync, inflateRawSync } from 'node:zlib';
import { removeUnusedSystemZlib } from './runtime-zlib.ts';

if (process.platform !== 'linux' || process.getuid() !== 0 || process.cwd() !== '/app')
  throw Error('运行库裁剪仅允许 Docker 构建阶段的 /app');
assert.equal(process.config.variables.node_shared_zlib, false);
assert.ok(
  !process.report.getReport().sharedObjects.some((path) => /\/libz\.so(?:\.|$)/u.test(path)),
);
const removed = await removeUnusedSystemZlib('/');
const plain = Buffer.from('runtime compression roundtrip');
assert.deepEqual(gunzipSync(gzipSync(plain)), plain);
assert.deepEqual(inflateRawSync(deflateRawSync(plain)), plain);
const require = createRequire('/app/package.json');
let nativeRequire;
if (existsSync('/app/apps/web/package.json')) {
  nativeRequire = createRequire(
    createRequire('/app/apps/web/package.json').resolve('next/package.json'),
  );
} else if (
  ['@personamarket/api', '@personamarket/worker'].includes(require('/app/package.json').name)
) {
  nativeRequire = createRequire(require.resolve('@personamarket/server'));
  const argon = nativeRequire('argon2');
  const hash = await argon.hash('runtime native binding roundtrip', { type: argon.argon2id });
  assert.equal(await argon.verify(hash, 'runtime native binding roundtrip'), true);
}
if (nativeRequire) {
  const sharp = nativeRequire('sharp');
  const source = sharp({ create: { width: 4, height: 4, channels: 3, background: '#224466' } });
  for (const format of ['png', 'jpeg', 'webp']) {
    const encoded = await source.clone().toFormat(format).toBuffer();
    const converted = await sharp(encoded).webp().toBuffer();
    assert.equal((await sharp(converted).metadata()).format, 'webp');
  }
}
assert.ok(
  !process.report.getReport().sharedObjects.some((path) => /\/libz\.so(?:\.|$)/u.test(path)),
);
console.log(
  JSON.stringify({
    removedSystemZlib: removed,
    compression: 'passed',
    nativeBindings: nativeRequire ? 'passed' : 'not-required',
  }),
);
