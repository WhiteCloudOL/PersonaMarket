import { StorageCleanupJobSchema, canonicalJson } from '@personamarket/contracts';
import type { Database } from '@personamarket/database';
import type { Storage } from './storage.js';
import { sql } from 'drizzle-orm';

/** 仅处理真实事件的随机不可复用键；业务引用检查与结果/消费回执同一短事务。 */
export async function cleanupStorageEvent(
  database: Database,
  storage: Storage,
  input: unknown,
  lastAttempt: boolean,
) {
  const data = StorageCleanupJobSchema.parse(input);
  return database.db
    .transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${'cleanup:' + data.storageKey},0))`,
      );
      const event = await tx.execute<{ topic: string; payload: unknown }>(
        sql`SELECT topic,payload FROM outbox_events WHERE id=${data.eventId}::uuid FOR UPDATE`,
      );
      const original = StorageCleanupJobSchema.omit({ eventId: true }).safeParse(
        event.rows[0]?.payload,
      );
      if (
        event.rows[0]?.topic !== 'storage.cleanup' ||
        !original.success ||
        canonicalJson(original.data) !==
          canonicalJson({ schemaVersion: data.schemaVersion, storageKey: data.storageKey })
      )
        throw Error('STORAGE_CLEANUP_EVENT_MISMATCH');
      const previous = await tx.execute<{ outcome: string; storage_key: string }>(
        sql`SELECT outcome,storage_key FROM storage_cleanup_runs WHERE event_id=${data.eventId}::uuid FOR UPDATE`,
      );
      const old = previous.rows[0];
      if (old && old.storage_key !== data.storageKey) throw Error('STORAGE_CLEANUP_EVENT_MISMATCH');
      if (old && ['deleted', 'missing', 'protected'].includes(old.outcome)) return old.outcome;
      const receipt = await tx.execute(
        sql`SELECT 1 FROM processed_events WHERE consumer='storage-cleanup' AND event_id=${data.eventId}::uuid`,
      );
      if (receipt.rowCount && !old) return 'unrecorded'; // 历史消费不能补造删除结果
      await tx.execute(
        sql`INSERT INTO storage_cleanup_runs(event_id,request_id,storage_key) VALUES(${data.eventId}::uuid,${data.eventId}::uuid,${data.storageKey}) ON CONFLICT DO NOTHING`,
      );
      // cleanup生产者仅在持有预览锁、移除到期预览时入队。confirm/stage也锁同预览；
      // 上传键为随机不可变键且LocalStorage.put使用wx，因此原键不会从过期预览重新注册。
      // 即便已存在正式素材或尚存预览，两个引用表的任意记录都会阻止物理删除。
      const references = await tx.execute(
        sql`SELECT 1 FROM assets WHERE storage_key=${data.storageKey} UNION ALL SELECT 1 FROM market_import_assets WHERE storage_key=${data.storageKey} LIMIT 1`,
      );
      let outcome: 'deleted' | 'missing' | 'protected' | 'failed' | 'pending' = 'protected';
      if (!references.rowCount) {
        try {
          await storage.delete(data.storageKey);
          outcome = 'deleted';
        } catch (cause) {
          if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')
            outcome = 'missing';
          else outcome = lastAttempt ? 'failed' : 'pending';
        }
      }
      await tx.execute(
        sql`UPDATE storage_cleanup_runs SET outcome=${outcome},execution_attempts=execution_attempts+1,checked_at=CASE WHEN ${outcome}='pending' THEN NULL ELSE clock_timestamp() END,error_code=CASE WHEN ${outcome}='failed' THEN 'STORAGE_CLEANUP_FAILED' ELSE NULL END WHERE event_id=${data.eventId}::uuid`,
      );
      if (outcome !== 'failed' && outcome !== 'pending')
        await tx.execute(
          sql`INSERT INTO processed_events(consumer,event_id) VALUES('storage-cleanup',${data.eventId}::uuid) ON CONFLICT DO NOTHING`,
        );
      return outcome;
    })
    .then((outcome) => {
      if (outcome === 'pending' || outcome === 'failed') throw Error('STORAGE_CLEANUP_FAILED');
      return outcome;
    });
}
