import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './runtime.mjs';

export const buildSourceVariable = 'PM_API_BUILD_SOURCE';

export function parseBuildSource(value, version) {
  if (!value) return null;
  try {
    const source = JSON.parse(value);
    if (
      source === null ||
      typeof source !== 'object' ||
      Array.isArray(source) ||
      Object.keys(source).sort().join(',') !== 'sourceDirty,sourceRevision,version' ||
      source.version !== version ||
      typeof source.sourceRevision !== 'string' ||
      !/^[a-f0-9]{40}$/u.test(source.sourceRevision) ||
      typeof source.sourceDirty !== 'boolean'
    )
      return null;
    return { version, sourceRevision: source.sourceRevision, sourceDirty: source.sourceDirty };
  } catch {
    return null;
  }
}

// Only build entry points inspect Git. Runtime requests read the generated artifact.
export function captureBuildSource(directory = root, env = process.env) {
  const { version } = JSON.parse(readFileSync(join(directory, 'apps/api/package.json'), 'utf8'));
  if (typeof version !== 'string' || !version || version.length > 100) throw Error('API包版本无效');
  if (!existsSync(join(directory, '.git')))
    return parseBuildSource(env[buildSourceVariable], version);
  const options = { cwd: directory, encoding: 'utf8', windowsHide: true };
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], options);
  const status = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=normal'],
    options,
  );
  if (revision.status !== 0 || status.status !== 0) return null;
  return parseBuildSource(
    JSON.stringify({
      version,
      sourceRevision: revision.stdout.trim(),
      sourceDirty: status.stdout.length > 0,
    }),
    version,
  );
}

export function buildEnvironment(env = process.env) {
  return { ...env, [buildSourceVariable]: JSON.stringify(captureBuildSource(root, env)) };
}
