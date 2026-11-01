import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './runtime.mjs';
import { format, resolveConfig } from 'prettier';

const formatting = await resolveConfig(join(root, 'package.json'));
const json = (value) => format(JSON.stringify(value), { ...formatting, parser: 'json' });

if (!process.env.npm_execpath) throw new Error('请通过 pnpm 运行。');
const result = spawnSync(
  process.execPath,
  [process.env.npm_execpath, 'licenses', 'list', '--json'],
  {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  },
);
if (result.status !== 0) throw new Error('无法生成实际依赖许可清单。');
const inventory = JSON.parse(result.stdout);
const records = [];
const withoutFiles = [];
for (const [license, packages] of Object.entries(inventory)) {
  for (const item of packages) {
    const notices = new Set();
    for (const path of item.paths ?? []) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.isFile() && /^(licen[cs]e|notice|copying)([._-].*)?$/i.test(entry.name)) {
          notices.add(readFileSync(join(path, entry.name), 'utf8').replaceAll('\r\n', '\n'));
        }
      }
    }
    const identifier = `${item.name}@${item.versions.join(', ')}`;
    if (!notices.size) withoutFiles.push(identifier);
    records.push({
      identifier,
      text: `${identifier}\nDeclared license: ${license}\n${[...notices].join('\n\n') || 'No standalone license file included in this package; consult upstream.'}`,
    });
    delete item.paths;
  }
}
records.sort((a, b) => a.identifier.localeCompare(b.identifier, 'en'));
mkdirSync(join(root, 'docs/third-party'), { recursive: true });
writeFileSync(join(root, 'docs/third-party/dependency-licenses.json'), await json(inventory));
writeFileSync(
  join(root, 'docs/third-party/npm-LICENSES.txt'),
  records.map((record) => record.text).join('\n\n' + '='.repeat(80) + '\n\n') + '\n',
);
writeFileSync(
  join(root, 'docs/third-party/license-file-gaps.json'),
  await json({ packagesWithoutStandaloneLicenseFile: withoutFiles.sort() }),
);
console.log(
  `已生成 ${records.length} 个依赖的许可说明；${withoutFiles.length} 个包未附独立许可文件，已单列。`,
);
