// The native process has no external route; only a fixed incoming reverse proxy is exposed.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { docker, lock } from './native-runtime.js';

export function startAstrBot(directory: string) {
  mkdirSync(join(directory, 'astrbot'), { recursive: true, mode: 0o700 });
  const password = randomBytes(32).toString('base64url') + 'aA1!';
  const secret = join(directory, 'astrbot.env');
  writeFileSync(secret, `ASTRBOT_DASHBOARD_INITIAL_PASSWORD=${password}\n`, { mode: 0o600 });
  const name = `pm-native-${randomUUID().replaceAll('-', '')}`;
  docker(['network', 'create', '--internal', name]);
  docker(['network', 'create', name + '-ingress']);
  const proxy = name + '-proxy';
  const config = join(directory, 'Caddyfile');
  writeFileSync(config, ':6185 {\n reverse_proxy native:6185\n}\n');
  try {
    docker([
      'run',
      '-d',
      '--name',
      name,
      '--network',
      name,
      '--env-file',
      secret,
      '--network-alias',
      'native',
      '--mount',
      `type=bind,src=${join(directory, 'astrbot')},dst=/AstrBot/data`,
      '--security-opt',
      'no-new-privileges:true',
      '--cap-drop',
      'ALL',
      lock.astrbot.image,
    ]);
    docker([
      'run',
      '-d',
      '--name',
      proxy,
      '--network',
      name + '-ingress',
      '-p',
      '127.0.0.1::6185',
      '--mount',
      `type=bind,src=${config},dst=/etc/caddy/Caddyfile,readonly`,
      '--read-only',
      '--tmpfs',
      '/tmp',
      '-e',
      'XDG_DATA_HOME=/tmp/data',
      '-e',
      'XDG_CONFIG_HOME=/tmp/config',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      'personamarket-caddy:2.11.7-pm.2',
    ]);
    docker(['network', 'connect', name, proxy]);
    const port = docker(['port', proxy, '6185/tcp']).split(':').at(-1);
    return { name, proxy, password, origin: `http://127.0.0.1:${port}` };
  } catch (error) {
    writeFileSync(
      join(directory, 'startup.log'),
      docker(['logs', name]).replaceAll(password, '[REDACTED]'),
      { mode: 0o600 },
    );
    docker(['rm', '-f', proxy]);
    docker(['rm', '-f', name]);
    docker(['network', 'rm', name + '-ingress']);
    docker(['network', 'rm', name]);
    throw error;
  }
}
