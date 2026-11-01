import { sql } from 'drizzle-orm';
import type { Database } from '@personamarket/database';
import { BusinessError } from '@personamarket/server';
import type { Transaction } from '../auth/locked-identity.js';

export async function administrationTransaction<T>(
  database: Database,
  operation: (tx: Transaction) => Promise<T>,
  options: {
    serializeWrites?: boolean;
    isolationLevel?: 'read committed' | 'repeatable read';
    area: 'users' | 'personas' | 'content';
  },
) {
  try {
    return await database.db.transaction(
      async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout='3s'`);
        // 所有跨账号管理使用同一PMRK/2锁，并先于actor/session/target行锁取得
        if (options.serializeWrites)
          await tx.execute(sql`SELECT pg_advisory_xact_lock(1347244619,2)`);
        return operation(tx);
      },
      { isolationLevel: options.isolationLevel ?? 'read committed' },
    );
  } catch (cause) {
    let current: unknown = cause;
    for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
      if ('code' in current) {
        const code = String(current.code);
        if (code === '23514' && current.message === 'LAST_ACTIVE_ADMIN')
          throw new BusinessError('CONFLICT', '至少需要保留一个有效管理员', { cause });
        if (['57014', '55P03', '40P01', '40001'].includes(code))
          throw new BusinessError(
            'SERVICE_UNAVAILABLE',
            options.area === 'content'
              ? '运营管理服务繁忙，请稍后重试'
              : options.area === 'personas'
                ? '人设管理服务繁忙，请稍后重试'
                : '用户管理服务繁忙，请稍后重试',
            { cause, retryAfterSeconds: 1 },
          );
      }
      current = current.cause;
    }
    throw cause;
  }
}
