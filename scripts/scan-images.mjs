import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './runtime.mjs';

const scanner =
  'aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c';
const images = [
  'personamarket-api:0.0.0',
  'personamarket-worker:0.0.0',
  'personamarket-web:0.0.0',
  'personamarket-migrate:0.0.0',
  'personamarket-postgres:18.6-pm.2',
  'personamarket-redis:8.2.7-pm.1',
  'personamarket-caddy:2.11.7-pm.2',
  'axllent/mailpit:v1.32.0@sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498',
  'alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a',
];
const directory = join(root, 'data', 'cache', 'images');
mkdirSync(directory, { recursive: true });
const cache = join(root, 'data', 'cache', 'trivy');
mkdirSync(cache, { recursive: true, mode: 0o700 });
function docker(args, timeout = 600_000) {
  const result = spawnSync('docker', args, {
    cwd: root,
    windowsHide: true,
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error((result.stderr || result.error?.message || 'Docker 扫描失败').slice(-2000));
  return result.stdout;
}
// 导出镜像文件供扫描器读取；不挂载 Docker socket。
const results = [];
mkdirSync(join(root, '.development/evidence'), { recursive: true });
for (const image of images) {
  const name = image.split(':')[0].replaceAll('/', '-');
  const path = join(directory, `${name}.tar`);
  console.log(`扫描镜像：${image}`);
  try {
    const imageId = docker(['image', 'inspect', '--format', '{{.Id}}', image]).trim();
    docker(['image', 'save', '-o', path, image]);
    const output = docker([
      'run',
      '--rm',
      '--mount',
      `type=bind,src=${path},dst=/scan.tar,readonly`,
      '--mount',
      `type=bind,src=${cache},dst=/root/.cache/trivy`,
      scanner,
      'image',
      '--input',
      '/scan.tar',
      '--scanners',
      'vuln',
      '--format',
      'json',
      '--quiet',
      '--timeout',
      '8m',
    ]);
    const report = JSON.parse(output);
    writeFileSync(
      join(root, `.development/evidence/image-${name}.json`),
      JSON.stringify(report, null, 2) + '\n',
    );
    const vulnerabilities = (report.Results ?? []).flatMap((item) => item.Vulnerabilities ?? []);
    const counts = {};
    for (const issue of vulnerabilities) counts[issue.Severity] = (counts[issue.Severity] ?? 0) + 1;
    results.push({
      image,
      imageId,
      status: 'scanned',
      os: report.Metadata?.OS,
      counts,
      fixableHighCritical: vulnerabilities.filter(
        (issue) => ['CRITICAL', 'HIGH'].includes(issue.Severity) && issue.FixedVersion,
      ).length,
    });
    if (vulnerabilities.some((issue) => ['CRITICAL', 'HIGH'].includes(issue.Severity)))
      process.exitCode = 1;
  } catch (error) {
    results.push({ image, status: 'blocked', reason: error.message });
    process.exitCode = 1;
    // 共享漏洞库不可用时，其余镜像也无法完成核验；保留明确的失败结果。
    break;
  }
}
writeFileSync(
  join(root, '.development/evidence/image-scan.json'),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      scanner,
      results,
      unscanned: images.filter((item) => !results.some((result) => result.image === item)),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(results.map(({ image, status, counts }) => ({ image, status, counts }))),
);
