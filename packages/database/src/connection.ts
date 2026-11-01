import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

function fromPool(pool: pg.Pool) {
  pool.on('error', () => undefined);
  return { pool, db: drizzle(pool, { schema }), close: () => pool.end() };
}
export function createDatabase(connectionString: string) {
  return fromPool(
    new pg.Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 10_000,
      statement_timeout: 5_000,
      query_timeout: 6_000,
      application_name: 'personamarket',
    }),
  );
}

/** 测试库的创建/删除包含checkpoint与目录I/O，独立于业务请求预算 */
export function createTestDatabaseOwner(connectionString: string) {
  if (!new URL(connectionString).pathname.endsWith('_test'))
    throw new Error('测试维护连接必须显式指向以 _test 结尾的数据库');
  return fromPool(
    new pg.Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 15000,
      query_timeout: 16000,
      options: '-c lock_timeout=1000',
      application_name: 'personamarket-test-ddl',
    }),
  );
}
export type Database = ReturnType<typeof createDatabase>;
