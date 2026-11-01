import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ADMIN_TASK_QUEUE_SAMPLE_LIMIT,
  AssetImportJobSchema,
  MailJobSchema,
  MarketImportImageJobSchema,
  NotificationDeliveryJobSchema,
  RankingRefreshJobSchema,
  StorageCleanupJobSchema,
  SystemJobSchema,
  type AdminTaskQueueObservation,
} from '@personamarket/contracts';
import { createSystemQueue } from './outbox.js';

export interface FailedQueueSample {
  event_id: string;
  topic: string;
  reference_key: string | null;
  reference_id: string | null;
  fingerprint_key: string | null;
  fingerprint: string | null;
  schema_version: number | null;
  payload_keys: string[];
  attempts: number;
  finished_at: string;
}
const parsers = {
  'auth.email': MailJobSchema,
  'asset.import': AssetImportJobSchema,
  'market.image': MarketImportImageJobSchema,
  'notification.deliver': NotificationDeliveryJobSchema,
  'rankings.refresh': RankingRefreshJobSchema,
  'storage.cleanup': StorageCleanupJobSchema,
  'system.bootstrap': SystemJobSchema,
  'system.probe': SystemJobSchema,
};
const jobMetadata = z.object({
  id: z.uuid(),
  name: z.string(),
  data: z.unknown(),
  attemptsMade: z.number().int().min(0).max(2_147_483_647),
  finishedOn: z.number().int().min(1).max(8_640_000_000_000_000),
});
function sample(input: unknown): FailedQueueSample | undefined {
  const metadata = jobMetadata.safeParse(input);
  if (!metadata.success) return;
  const job = metadata.data;
  if (!Object.hasOwn(parsers, job.name)) return;
  const parser = parsers[job.name as keyof typeof parsers];
  const parsed = parser.safeParse(job.data);
  if (!parsed.success || parsed.data.eventId.toLowerCase() !== job.id.toLowerCase()) return;
  const data = parsed.data;
  const fields = z.record(z.string(), z.unknown()).parse(data);
  const record: FailedQueueSample = {
    event_id: data.eventId.toLowerCase(),
    topic: job.name,
    attempts: job.attemptsMade,
    finished_at: new Date(job.finishedOn).toISOString(),
    reference_key: null,
    reference_id: null,
    fingerprint_key: null,
    fingerprint: null,
    schema_version: 'schemaVersion' in data ? data.schemaVersion : null,
    payload_keys: Object.keys(data).filter((key) => key !== 'eventId'),
  };
  for (const key of ['jobId', 'assetId', 'notificationId', 'generationId'] as const) {
    if (typeof fields[key] === 'string') {
      record.reference_key = key;
      record.reference_id = fields[key].toLowerCase();
    }
  }
  for (const key of ['encryptedMessage', 'storageKey'] as const) {
    if (typeof fields[key] === 'string') {
      record.fingerprint_key = key;
      record.fingerprint = createHash('md5').update(fields[key]).digest('hex');
    }
  }
  return record;
}

/** 有界采样本队列，严格匹配契约；不输出原始任务、收件地址或failedReason */
export async function inspectFailedQueueTasks(
  redisUrl: string,
  name: string,
): Promise<{
  meta: AdminTaskQueueObservation;
  samples: FailedQueueSample[];
}> {
  const checkedAt = new Date().toISOString(),
    queue = createSystemQueue(redisUrl, name);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      (async () => {
        await queue.waitUntilReady();
        const counts = await queue.getJobCounts('failed');
        const jobs = await queue.getJobs(['failed'], 0, ADMIN_TASK_QUEUE_SAMPLE_LIMIT - 1, false);
        const samples: FailedQueueSample[] = [];
        let unverifiable = 0;
        for (const job of jobs) {
          const parsed = sample(job);
          if (parsed) samples.push(parsed);
          else unverifiable++;
        }
        const retainedFailed = z
          .object({ failed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })
          .parse(counts).failed;
        return {
          meta: {
            status:
              retainedFailed !== jobs.length || unverifiable
                ? ('partial' as const)
                : ('ready' as const),
            checkedAt,
            retainedFailed,
            inspected: jobs.length,
            unverifiable,
            limit: ADMIN_TASK_QUEUE_SAMPLE_LIMIT,
          } satisfies AdminTaskQueueObservation,
          samples,
        };
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(Error('QUEUE_OBSERVATION_TIMEOUT')), 3000);
      }),
    ]);
    return result;
  } catch {
    return {
      meta: {
        status: 'unavailable',
        checkedAt,
        retainedFailed: null,
        inspected: 0,
        unverifiable: 0,
        limit: ADMIN_TASK_QUEUE_SAMPLE_LIMIT,
      },
      samples: [],
    };
  } finally {
    if (timeout) clearTimeout(timeout);
    // 专属观测连接可强制断开；不会触碰Worker或其他请求的连接
    await queue.disconnect().catch(() => undefined);
    await queue.close().catch(() => undefined);
  }
}
