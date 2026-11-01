import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSourceVariable, captureBuildSource, parseBuildSource } from './build-provenance.mjs';
import { pnpm } from './runtime.mjs';

const { version } = JSON.parse(
  readFileSync(new URL('../apps/api/package.json', import.meta.url), 'utf8'),
);
// A Turbo/Docker entry point supplies a frozen build input; direct API builds capture it here.
const source =
  process.env[buildSourceVariable] === undefined
    ? captureBuildSource()
    : parseBuildSource(process.env[buildSourceVariable], version);
const child = pnpm(['exec', 'tsc', '-p', 'apps/api/tsconfig.build.json']);
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
});
if (code === 0) {
  const build = source
    ? { ...source, builtAt: new Date().toISOString(), status: 'available' }
    : {
        version: null,
        sourceRevision: null,
        sourceDirty: null,
        builtAt: null,
        status: 'unavailable',
      };
  mkdirSync(new URL('../apps/api/dist/', import.meta.url), { recursive: true });
  writeFileSync(
    new URL('../apps/api/dist/build-info.json', import.meta.url),
    JSON.stringify(build, null, 2) + '\n',
  );
}
process.exitCode = typeof code === 'number' ? code : 1;
