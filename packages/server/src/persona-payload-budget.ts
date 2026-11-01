import { sql } from 'drizzle-orm';
import type { Database } from '@personamarket/database';
import { BusinessError } from './errors.js';

type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
const maximumBytes = 4 * 1024 * 1024;

/** 预览与最终草稿共用既有存储预算，调用方在身份锁定后的同一事务中执行 */
export async function assertPersonaPayloadBudget(tx: Transaction, payload: unknown) {
  const pending: unknown[] = [payload];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string') {
      for (const character of value) {
        const code = character.codePointAt(0) ?? 0;
        if (code === 0 || (code >= 0xd800 && code <= 0xdfff))
          throw new BusinessError(
            'INVALID_INPUT',
            '正文或相关资料包含空字符或不完整的 Unicode 字符，请检查后重试',
          );
      }
    } else if (value !== null && typeof value === 'object') pending.push(...Object.values(value));
  }
  const source = JSON.stringify(payload);
  if (source === undefined) throw new Error('PERSONA_PAYLOAD_NOT_SERIALIZABLE');
  // jsonb会添加分隔空白，不能以JSON.stringify的字节数冒充实际约束大小
  const result = await tx.execute<{ bytes: number }>(
    sql`SELECT octet_length(${source}::jsonb::text) AS bytes`,
  );
  const bytes = result.rows[0]?.bytes;
  if (typeof bytes !== 'number') throw new Error('PERSONA_PAYLOAD_SIZE_UNAVAILABLE');
  if (bytes > maximumBytes)
    throw new BusinessError('INVALID_INPUT', '正文与相关资料合计不能超过 4 MiB，请减少内容后重试');
}
