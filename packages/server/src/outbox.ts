import {
  AssetImportJobSchema,
  MailJobSchema,
  SystemJobSchema,
  MarketImportImageJobSchema,
  StorageCleanupJobSchema,
  RankingRefreshJobSchema,
  NotificationDeliveryJobSchema,
} from '@personamarket/contracts';
import type { Database } from '@personamarket/database';
import { Queue, Worker } from 'bullmq';
import type { z } from 'zod';
import type { AppLogger } from './logger.js';
import { queueConnection } from './redis.js';
import type { MailSender } from './mail.js';
import { deliverMail } from './mail-delivery.js';
import type { Storage } from './storage.js';
import { reconcileNotificationFailures } from './notification-recovery.js';
import { reconcileRankingFailures } from './ranking-recovery.js';

type SystemJob = z.infer<typeof SystemJobSchema>;
type WorkerJob =
  | SystemJob
  | z.infer<typeof MailJobSchema>
  | z.infer<typeof AssetImportJobSchema>
  | z.infer<typeof MarketImportImageJobSchema>
  | z.infer<typeof StorageCleanupJobSchema>
  | z.infer<typeof NotificationDeliveryJobSchema>
  | z.infer<typeof RankingRefreshJobSchema>;
type PendingEvent = { id: string; topic: string; payload: unknown };
export function createSystemQueue(redisUrl: string, name: string) {
  const queue = new Queue<WorkerJob>(name, { connection: queueConnection(redisUrl, true) });
  queue.on('error', () => undefined);
  return queue;
}

/** 认领使用租约；投递后的 DB 写入失败允许重复投递，由消费者唯一键兜底。 */
export async function dispatchOutbox(
  database: Database,
  queue: Queue<WorkerJob>,
  logger: AppLogger,
) {
  const claimed = await database.pool.query<PendingEvent>(`
    UPDATE outbox_events SET lease_until = now() + interval '30 seconds', attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM outbox_events
      WHERE delivered_at IS NULL AND attempts < 5 AND available_at <= now()
        AND (lease_until IS NULL OR lease_until < now())
      ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT 10
    ) RETURNING id, topic, payload
  `);
  for (const event of claimed.rows) {
    try {
      if (
        ![
          'system.bootstrap',
          'system.probe',
          'auth.email',
          'asset.import',
          'market.image',
          'storage.cleanup',
          'rankings.refresh',
          'notification.deliver',
        ].includes(event.topic)
      )
        throw new Error('UNSUPPORTED_TOPIC');
      const payload =
        event.topic === 'notification.deliver'
          ? NotificationDeliveryJobSchema.omit({ eventId: true }).parse(event.payload)
          : event.topic === 'rankings.refresh'
            ? RankingRefreshJobSchema.omit({ eventId: true }).parse(event.payload)
            : event.topic === 'market.image'
              ? MarketImportImageJobSchema.omit({ eventId: true }).parse(event.payload)
              : event.topic === 'storage.cleanup'
                ? StorageCleanupJobSchema.omit({ eventId: true }).parse(event.payload)
                : event.topic === 'asset.import'
                  ? AssetImportJobSchema.omit({ eventId: true }).parse(event.payload)
                  : event.topic === 'auth.email'
                    ? MailJobSchema.omit({ eventId: true }).parse(event.payload)
                    : SystemJobSchema.omit({ eventId: true }).parse(event.payload);
      await queue.add(
        event.topic,
        { eventId: event.id, ...payload },
        {
          jobId: event.id,
          attempts: 5,
          backoff: { type: 'exponential', delay: event.topic === 'asset.import' ? 5_000 : 1_000 },
          removeOnComplete: { age: 86_400, count: 1_000 },
          removeOnFail: false,
        },
      );
      await database.pool.query(
        'UPDATE outbox_events SET delivered_at = now(), lease_until = NULL, last_error_code = NULL WHERE id = $1',
        [event.id],
      );
      logger.info({ event: 'outbox.delivered', jobId: event.id });
    } catch {
      await database.pool.query(
        `UPDATE outbox_events SET lease_until = NULL,
        available_at = now() + make_interval(secs => LEAST(60, power(2, attempts)::integer)),
        last_error_code = 'DELIVERY_FAILED' WHERE id = $1`,
        [event.id],
      );
      logger.warn({ event: 'outbox.delivery_failed', jobId: event.id, code: 'DELIVERY_FAILED' });
    }
  }
  await reconcileNotificationFailures(database, queue);
  await reconcileRankingFailures(database, queue);
  return claimed.rowCount ?? 0;
}

export function createSystemWorker(
  database: Database,
  redisUrl: string,
  name: string,
  logger: AppLogger,
  mail?: { sender: MailSender; encryptionKey: string },
  image?: { storage: Storage },
) {
  const worker = new Worker<WorkerJob>(
    name,
    async (job) => {
      if (job.name === 'notification.deliver') {
        const data = NotificationDeliveryJobSchema.parse(job.data);
        const { deliverNotification } = await import('./notification-delivery.js');
        const state = await deliverNotification(database, data, {
          number: job.attemptsMade + 1,
          last: job.attemptsMade + 1 >= (job.opts.attempts ?? 5),
        });
        logger.info({ event: 'notification.processed', jobId: data.eventId, state });
        return;
      }
      if (job.name === 'rankings.refresh') {
        const data = RankingRefreshJobSchema.parse(job.data);
        const { buildRankingGeneration } = await import('./ranking-refresh.js');
        await buildRankingGeneration(database, data.generationId, data.eventId, {
          number: job.attemptsMade + 1,
          last: job.attemptsMade + 1 >= (job.opts.attempts ?? 5),
          limit: job.opts.attempts ?? 5,
        });
        logger.info({ event: 'rankings.refreshed', jobId: data.eventId });
        return;
      }
      if (job.name === 'market.image') {
        const data = MarketImportImageJobSchema.parse(job.data);
        const done = await database.pool.query(
          'SELECT 1 FROM processed_events WHERE consumer=$1 AND event_id=$2',
          ['market-image', data.eventId],
        );
        if (done.rowCount) return;
        if (!image) throw new Error('IMAGE_PROCESSING_NOT_CONFIGURED');
        const { processMarketImage } = await import('./market-import-storage.js');
        await processMarketImage(
          database,
          image.storage,
          data.assetId,
          job.attemptsMade + 1 >= (job.opts.attempts ?? 5),
        );
        await database.pool.query(
          'INSERT INTO processed_events(consumer,event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          ['market-image', data.eventId],
        );
        return;
      }
      if (job.name === 'storage.cleanup') {
        const data = StorageCleanupJobSchema.parse(job.data);
        if (!image) throw new Error('STORAGE_NOT_CONFIGURED');
        const { cleanupStorageEvent } = await import('./storage-cleanup.js');
        await cleanupStorageEvent(
          database,
          image.storage,
          data,
          job.attemptsMade + 1 >= (job.opts.attempts ?? 5),
        );
        return;
      }
      if (job.name === 'asset.import') {
        const data = AssetImportJobSchema.parse(job.data);
        const done = await database.pool.query(
          'SELECT 1 FROM processed_events WHERE consumer=$1 AND event_id=$2',
          ['asset-import', data.eventId],
        );
        if (done.rowCount) return;
        if (!image) throw new Error('IMAGE_PROCESSING_NOT_CONFIGURED');
        const { processRemoteImage } = await import('./asset-processing.js');
        await processRemoteImage(
          database,
          image.storage,
          data.jobId,
          job.attemptsMade + 1 >= (job.opts.attempts ?? 5),
        );
        await database.pool.query(
          'INSERT INTO processed_events(consumer,event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          ['asset-import', data.eventId],
        );
        return;
      }
      if (job.name === 'auth.email') {
        const state = await deliverMail(database, job.data, mail);
        logger.info({ event: 'mail.processed', jobId: job.data.eventId, state });
        return;
      }
      if (!['system.bootstrap', 'system.probe'].includes(job.name))
        throw new Error('UNSUPPORTED_TOPIC');
      const data = SystemJobSchema.parse(job.data);
      const result = await database.pool.query(
        `INSERT INTO processed_events (consumer, event_id)
      VALUES ('system', $1) ON CONFLICT DO NOTHING RETURNING event_id`,
        [data.eventId],
      );
      logger.info({
        event: result.rowCount ? 'job.completed' : 'job.duplicate',
        jobId: data.eventId,
      });
    },
    { connection: queueConnection(redisUrl), concurrency: 1 },
  );
  worker.on('failed', (job) =>
    logger.error({ event: 'job.failed', jobId: job?.id, code: 'JOB_FAILED' }),
  );
  worker.on('error', () =>
    logger.error({ event: 'worker.connection_failed', code: 'QUEUE_UNAVAILABLE' }),
  );
  return worker;
}
