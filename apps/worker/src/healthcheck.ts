import { hostname } from 'node:os';
import { createClient } from 'redis';

const url = process.env['REDIS_URL'];
if (!url) throw new Error('缺少 REDIS_URL。');
const client = createClient({ url, socket: { connectTimeout: 2_000, reconnectStrategy: false } });
client.on('error', () => undefined);
try {
  await client.connect();
  const ttl = await client.ttl(`personamarket:worker:${hostname()}`);
  if (ttl <= 0) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  if (client.isOpen) client.destroy();
}
