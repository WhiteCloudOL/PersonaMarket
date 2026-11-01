import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { environment, root } from './runtime.mjs';

const env = environment();
mkdirSync(join(root, '.development/evidence'), { recursive: true });
const keys = [
  'POSTGRES_PASSWORD',
  'POSTGRES_APP_PASSWORD',
  'REDIS_PASSWORD',
  'APP_ENCRYPTION_KEY',
  'STATS_HMAC_KEY',
  'SMTP_PASSWORD',
];
const secrets = keys
  .map((key) => env[key])
  .filter((value) => value && value.length >= 24 && !value.startsWith('CHANGE_ME'));
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8', windowsHide: true },
)
  .split('\0')
  .filter((file) => file && existsSync(join(root, file)));
const failures = [];
for (const file of files) {
  if (file.startsWith('.agents/')) continue;
  const value = readFileSync(join(root, file), 'utf8');
  if (
    secrets.some((secret) => value.includes(secret)) ||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)
  )
    failures.push(`疑似秘密进入源码：${file}`);
}
function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(directory, entry.name))
      : /\.(js|css|html|json)$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
}
for (const file of walk(join(root, 'apps/web/.next/static'))) {
  if (secrets.some((secret) => readFileSync(file, 'utf8').includes(secret)))
    failures.push(`秘密进入浏览器产物：${relative(root, file)}`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('源码与浏览器产物中的本机秘密扫描通过。');
  if (!process.env.npm_execpath) throw new Error('请通过 pnpm 运行。');
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, 'audit', '--prod', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const audit = JSON.parse(result.stdout);
  writeFileSync(
    join(root, '.development/evidence/npm-audit.json'),
    JSON.stringify(audit, null, 2) + '\n',
  );
  console.log(
    `生产依赖漏洞统计：${JSON.stringify(audit.metadata?.vulnerabilities ?? audit.error ?? {})}`,
  );
  writeFileSync(
    join(root, '.development/evidence/security-scan.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        sourceFiles: files.length,
        secretScan: 'passed',
        productionAuditExitCode: result.status,
      },
      null,
      2,
    ) + '\n',
  );
  process.exitCode = result.status ?? 1;
}
