import { buildEnvironment } from './build-provenance.mjs';
import { pnpm } from './runtime.mjs';

const args = process.argv.slice(2);
if (!args.length) throw Error('需要指定Turbo任务');
const child = pnpm(['exec', 'turbo', 'run', '--concurrency=2', ...args], buildEnvironment());
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
});
process.exitCode = typeof code === 'number' ? code : 1;
