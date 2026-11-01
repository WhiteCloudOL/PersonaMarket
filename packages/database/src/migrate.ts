import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './connection.js';
import { backfillPublicSearch } from './backfill-search.js';

export async function migrateDatabase(connectionString: string) {
  const database = createDatabase(connectionString);
  const client = await database.pool.connect();
  try {
    // 单一数据库会话持有锁，确保多个启动进程不会同时执行 DDL。
    await client.query("SELECT pg_advisory_lock(hashtext('personamarket:migrations'))");
    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL('../migrations/', import.meta.url)),
    });
    await backfillPublicSearch(client);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('personamarket:migrations'))");
    } finally {
      client.release();
      await database.close();
    }
  }
}
