import { spawnSync } from 'node:child_process';
import { environment, root } from './runtime.mjs';
import { redactInfrastructureLog } from './infra-log-redaction.ts';

const env = environment();
for (const service of ['postgres', 'redis', 'mailpit']) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      'compose.dev.yaml',
      'logs',
      '--no-color',
      '--tail=60',
      service,
    ],
    { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 1_048_576 },
  );
  const output = redactInfrastructureLog(
    (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? ''),
    env,
  );
  console.log(`${service} initialization diagnostics\n${output.slice(-8000)}`);
}
