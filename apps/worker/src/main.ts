import { hostname } from 'node:os';
import { createDatabase } from '@personamarket/database';
import {
  createLogger,
  createSystemQueue,
  createSystemWorker,
  dispatchOutbox,
  parseServerEnvironment,
  MailSender,
  MailConfigurationStore,
  LocalStorage,
  pruneImportPreviews,
  pruneMarketImports,
  pruneExportSubjects,
  enqueueConfiguredRankingRefresh,
  pruneRankings,
} from '@personamarket/server';
import { createClient } from 'redis';

const logger = createLogger('worker');
const cleanup: Array<() => Promise<unknown>> = [];
async function releaseResources() {
  for (const close of cleanup.reverse()) {
    try {
      await close();
    } catch {
      logger.error({ event: 'worker.cleanup_failed', code: 'SHUTDOWN_FAILED' });
      process.exitCode = 1;
    }
  }
  cleanup.length = 0;
}
try {
  const env = parseServerEnvironment(process.env);
  const database = createDatabase(env.DATABASE_URL);
  cleanup.push(() => database.close());
  const redis = createClient({
    url: env.REDIS_URL,
    socket: { connectTimeout: 2_000, reconnectStrategy: false },
  });
  redis.on('error', () =>
    logger.error({ event: 'heartbeat.connection_failed', code: 'REDIS_UNAVAILABLE' }),
  );
  cleanup.push(async () => {
    if (redis.isOpen) redis.destroy();
  });
  await redis.connect();
  await database.pool.query('SELECT 1 FROM outbox_events LIMIT 1');
  const queue = createSystemQueue(env.REDIS_URL, env.QUEUE_NAME);
  cleanup.push(() => queue.close());
  await queue.waitUntilReady();
  const mailSettings = new MailConfigurationStore(database, env);
  const sender = new MailSender(env, () => mailSettings.current());
  cleanup.push(async () => sender.close());
  const worker = createSystemWorker(
    database,
    env.REDIS_URL,
    env.QUEUE_NAME,
    logger,
    {
      sender,
      encryptionKey: env.APP_ENCRYPTION_KEY,
    },
    { storage: new LocalStorage(env.STORAGE_ROOT) },
  );
  cleanup.push(() => worker.close());
  await worker.waitUntilReady();
  let stopped = false;
  let nextMaintenanceAt = 0;
  let pending: Promise<void> | undefined;
  const heartbeat = `personamarket:worker:${hostname()}`;
  async function tick() {
    if (stopped || pending) return;
    pending = (async () => {
      try {
        await dispatchOutbox(database, queue, logger);
        if (Date.now() >= nextMaintenanceAt) {
          await pruneImportPreviews(database);
          await pruneMarketImports(database);
          await pruneExportSubjects(database);
          await enqueueConfiguredRankingRefresh(database);
          await pruneRankings(database);
          nextMaintenanceAt = Date.now() + 60_000;
        }
        await redis.set(heartbeat, new Date().toISOString(), { EX: 30 });
      } catch {
        logger.error({ event: 'worker.tick_failed', code: 'DEPENDENCY_UNAVAILABLE' });
      }
    })();
    try {
      await pending;
    } finally {
      pending = undefined;
    }
  }
  await tick();
  const timer = setInterval(() => {
    void tick();
  }, env.WORKER_POLL_INTERVAL_MS);
  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    await pending;
    await releaseResources();
  };
  process.once('SIGTERM', () => {
    void shutdown();
  });
  process.once('SIGINT', () => {
    void shutdown();
  });
  logger.info({ event: 'worker.started' });
} catch {
  logger.error({ event: 'worker.start_failed', code: 'STARTUP_FAILED' });
  process.exitCode = 1;
  await releaseResources();
}
