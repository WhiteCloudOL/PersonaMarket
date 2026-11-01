import { createClient } from 'redis';
import type { ConnectionOptions } from 'bullmq';

export function queueConnection(url: string, producer = false): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: producer ? 1 : null,
    connectTimeout: 2_000,
    ...(producer
      ? {
          enableOfflineQueue: false,
          commandTimeout: 3_000,
          retryStrategy: (attempt: number) => (attempt <= 3 ? attempt * 200 : null),
        }
      : {}),
  };
}

export async function probeRedis(url: string) {
  const client = createClient({ url, socket: { connectTimeout: 2_000, reconnectStrategy: false } });
  client.on('error', () => undefined);
  try {
    await client.connect();
    return await client.ping();
  } finally {
    if (client.isOpen) client.destroy();
  }
}
