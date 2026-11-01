import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import semver from 'semver';
import { root } from './runtime.mjs';

const evidence = join(root, '.development', 'evidence');
mkdirSync(evidence, { recursive: true });
const metadataFile = join(evidence, 'npm-metadata.json');
const metadata = existsSync(metadataFile)
  ? JSON.parse(readFileSync(metadataFile, 'utf8'))
  : { checkedAt: new Date().toISOString(), registry: 'https://registry.npmjs.org', packages: [] };
const reviewed = new Map(metadata.packages.map((item) => [`${item.name}@${item.version}`, item]));
const manifests = [join(root, 'package.json')];
for (const group of ['apps', 'packages'])
  for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
    if (entry.isDirectory()) manifests.push(join(root, group, entry.name, 'package.json'));
  }
const required = new Map();
for (const file of manifests) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  for (const [name, version] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    if (semver.valid(version) && !reviewed.has(`${name}@${version}`))
      required.set(`${name}@${version}`, { name, version });
  }
}
const pending = [...required.values()];
const execute = promisify(execFile);
await Promise.all(
  Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (pending.length) {
      const dependency = pending.shift();
      if (!dependency) break;
      if (!process.env.npm_execpath) throw new Error('请通过 pnpm 执行依赖核验。');
      let value;
      try {
        const result = await execute(
          process.execPath,
          [
            process.env.npm_execpath,
            'view',
            `${dependency.name}@${dependency.version}`,
            '--json',
            '--registry=https://registry.npmjs.org/',
          ],
          { cwd: root, windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
        );
        value = JSON.parse(result.stdout);
      } catch {
        throw new Error(`无法从官方 registry 核验 ${dependency.name}@${dependency.version}。`);
      }
      if (
        value.name !== dependency.name ||
        value.version !== dependency.version ||
        !value.dist?.integrity
      )
        throw new Error('官方包元信息与请求版本不匹配。');
      const record = {
        name: value.name,
        version: value.version,
        engines: value.engines,
        peerDependencies: value.peerDependencies,
        peerDependenciesMeta: value.peerDependenciesMeta,
        license: value.license,
        integrity: value.dist.integrity,
      };
      metadata.packages.push(record);
      reviewed.set(`${record.name}@${record.version}`, record);
    }
  }),
);
writeFileSync(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
const errors = [];
let count = 0;
function installed(directory, name) {
  let current = directory;
  while (true) {
    const path = join(current, 'node_modules', name, 'package.json');
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
for (const file of manifests) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  for (const [name, version] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    if (version.startsWith('workspace:')) continue;
    count++;
    if (!semver.valid(version) || semver.prerelease(version)) {
      errors.push(`${name} 必须锁定稳定精确版本。`);
      continue;
    }
    const actual = installed(dirname(file), name);
    if (!actual || actual.version !== version) {
      errors.push(`${name}@${version} 尚未正确安装。`);
      continue;
    }
    const source = reviewed.get(`${name}@${version}`);
    if (!source) errors.push(`${name}@${version} 缺少官方元信息核验记录。`);
    if (actual.engines?.node && !semver.satisfies(process.versions.node, actual.engines.node))
      errors.push(`${name} 不支持当前 Node.js。`);
    for (const [peer, range] of Object.entries(actual.peerDependencies ?? {})) {
      const dependency = installed(dirname(file), peer);
      if (!dependency && actual.peerDependenciesMeta?.[peer]?.optional) continue;
      if (!dependency || !semver.satisfies(dependency.version, range))
        errors.push(`${name} 的 peer ${peer}@${range} 未满足。`);
    }
  }
}
if (errors.length) {
  console.error([...new Set(errors)].join('\n'));
  process.exitCode = 1;
} else
  console.log(`依赖核验通过：${count} 项直接依赖声明；稳定版本、官方记录、Node 引擎与 peer 匹配。`);
