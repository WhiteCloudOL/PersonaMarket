import { createHash } from 'node:crypto';

/** API与Worker共用由独立测试库派生的队列，忽略宿主机的主站QUEUE_NAME。 */
export function e2eQueueName(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !/^\/[a-z][a-z0-9_]*_test$/.test(url.pathname)
  )
    throw new Error('E2E队列要求显式独立测试数据库');
  return (
    'e2e-' +
    createHash('sha256')
      .update(url.hostname + ':' + (url.port || '5432') + url.pathname)
      .digest('hex')
      .slice(0, 24)
  );
}
