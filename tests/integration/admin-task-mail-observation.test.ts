import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { Queue, Worker } from 'bullmq';
import { createDatabase } from '@personamarket/database';
import { AdminTaskListResponseSchema, MailJobSchema } from '@personamarket/contracts';
import {
  createAdministrator,
  deliverMail,
  enqueueMail,
  MailSender,
  queueConnection,
} from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { createSmtpProbe } from '../fixtures/smtp-probe.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
async function administrator() {
  const username = 'observe_admin_' + randomBytes(4).toString('hex'),
    password = randomBytes(20).toString('base64url');
  await createAdministrator(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password,
  });
  const http = stack.browser();
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  return { http };
}
async function prepareLegacyQueue() {
  await stack.tick();
  const queue = new Queue<unknown>(stack.env.QUEUE_NAME, {
    connection: queueConnection(stack.env.REDIS_URL, true),
  });
  queue.on('error', () => undefined);
  try {
    await expect
      .poll(async () => {
        const count = await queue.getJobCounts('waiting', 'active');
        return (count['waiting'] ?? 0) + (count['active'] ?? 0);
      })
      .toBe(0);
  } finally {
    await queue.close();
  }
}
async function legacyFailure(input: Awaited<ReturnType<typeof mailInput>>, corrupt = false) {
  return legacyFailures(
    [{ name: 'auth.email', data: corrupt ? { ...input.data, schemaVersion: 2 } : input.data }],
    input.marker,
  );
}
async function legacyFailures(
  entries: Array<{ name: string; data: { eventId: string; [key: string]: unknown } }>,
  marker: string,
) {
  await stack.worker.pause();
  const queue = new Queue<unknown>(stack.env.QUEUE_NAME, {
    connection: queueConnection(stack.env.REDIS_URL, true),
  });
  queue.on('error', () => undefined);
  // 升级前未记录业务状态的受控失败消费者；实际Redis执行，不改生产处理器
  const worker = new Worker<unknown>(
    stack.env.QUEUE_NAME,
    async () => {
      throw Error(marker);
    },
    { connection: queueConnection(stack.env.REDIS_URL), concurrency: 1 },
  );
  worker.on('error', () => undefined);
  try {
    await worker.waitUntilReady();
    const previousFailed = (await queue.getJobCounts('failed'))['failed'] ?? 0;
    const remaining = new Set(entries.map((entry) => entry.data.eventId));
    // 等待实际批次的生命周期，仍受原15秒用例预算限制，不用默认轮询预算替代501条执行
    const completed = new Promise<void>((resolve) => {
      worker.on('failed', (job) => {
        if (job?.id) remaining.delete(job.id);
        if (!remaining.size) resolve();
      });
    });
    const jobs = await queue.addBulk(
      entries.map(({ name, data }) => ({
        name,
        data,
        opts: { jobId: data.eventId, attempts: 1, removeOnFail: false },
      })),
    );
    await completed;
    expect((await queue.getJobCounts('failed'))['failed']).toBe(previousFailed + jobs.length);
    await stack.tick();
  } finally {
    await worker.close();
    await queue.close();
    await stack.worker.resume();
  }
}
async function mailInput() {
  const previous = (
    await stack.owner.pool.query<{ id: string }>(
      "SELECT id FROM outbox_events WHERE topic='auth.email'",
    )
  ).rows.map((row) => row.id);
  const marker = 'PRIVATE_TASK_MAIL_' + randomUUID();
  await stack.owner.db.transaction((tx) =>
    enqueueMail(tx, stack.env.APP_ENCRYPTION_KEY, {
      to: 'private-' + randomBytes(5).toString('hex') + '@fixture.invalid',
      subject: marker,
      text: marker,
    }),
  );
  const rows = (
    await stack.owner.pool.query<{ id: string; payload: unknown }>(
      "SELECT id,payload FROM outbox_events WHERE topic='auth.email' AND NOT(id=ANY($1::uuid[]))",
      [previous],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw Error('缺少实际邮件Outbox');
  return {
    marker,
    data: MailJobSchema.parse({
      eventId: row.id,
      ...z.record(z.string(), z.unknown()).parse(row.payload),
    }),
  };
}

it('SMTP结果待确认的持久邮件必须可查询，不能当作零失败或泄漏邮件内容', async () => {
  const admin = await administrator(),
    input = await mailInput(),
    probe = await createSmtpProbe({ dropAcceptance: true });
  const database = createDatabase(stack.env.DATABASE_URL),
    sender = new MailSender({ ...stack.env, SMTP_PORT: probe.port });
  try {
    await expect(
      deliverMail(database, input.data, { sender, encryptionKey: stack.env.APP_ENCRYPTION_KEY }),
    ).rejects.toThrow('MAIL_RESULT_UNCERTAIN');
    expect(probe.observations.accepted).toBe(1);
    const response = await admin.http.raw('/api/v1/admin/tasks?category=mail&stage=uncertain');
    expect(response.status).toBe(200);
    const body = AdminTaskListResponseSchema.parse(await response.json());
    expect(body.meta.total).toBe(1);
    expect(body.data).toEqual([
      expect.objectContaining({
        source: 'mail',
        id: input.data.eventId,
        category: 'mail',
        stage: 'uncertain',
        errorCode: 'MAIL_RESULT_UNCERTAIN',
        executionAttempts: 1,
        dispatchAttempts: 0,
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain(input.marker);
    expect(JSON.stringify(body)).not.toContain(input.data.encryptedMessage);
  } finally {
    sender.close();
    await database.close();
    await probe.close();
  }
});

it('已知未发送的邮件业务失败保留真实执行次数，旧Outbox失败不重复计数', async () => {
  const admin = await administrator();
  await prepareLegacyQueue();
  const input = await mailInput();
  const database = createDatabase(stack.env.DATABASE_URL),
    sender = new MailSender(stack.env, async () => undefined);
  try {
    await expect(
      deliverMail(database, input.data, { sender, encryptionKey: stack.env.APP_ENCRYPTION_KEY }),
    ).rejects.toThrow('MAIL_DELIVERY_FAILED');
    // 精确模拟“已进入Worker，但分发回执也未落库”的交界，不能计成两份邮件
    await stack.owner.pool.query(
      "UPDATE outbox_events SET attempts=5,last_error_code='DELIVERY_FAILED' WHERE id=$1",
      [input.data.eventId],
    );
    await legacyFailure(input);
    const response = await admin.http.raw('/api/v1/admin/tasks?category=mail');
    expect(response.status).toBe(200);
    const body = AdminTaskListResponseSchema.parse(await response.json());
    expect(body.meta.queueObservation).toMatchObject({ status: 'ready', retainedFailed: 1 });
    expect(body.meta.total).toBe(1);
    expect(body.data).toEqual([
      expect.objectContaining({
        source: 'mail',
        id: input.data.eventId,
        stage: 'execution',
        errorCode: 'MAIL_NOT_CONFIGURED',
        executionAttempts: 1,
        dispatchAttempts: 5,
      }),
    ]);
  } finally {
    sender.close();
    await database.close();
  }
});

it('保留队列超过500条时有界采样且明确部分观测，不将501条冒充完整500条', async () => {
  const admin = await administrator();
  await prepareLegacyQueue();
  const ids = Array.from({ length: 501 }, () => randomUUID());
  await stack.owner.pool.query(
    `INSERT INTO outbox_events(id,topic,payload,delivered_at)
      SELECT id,'system.probe','{"schemaVersion":1}',now() FROM unnest($1::uuid[]) id`,
    [ids],
  );
  await legacyFailures(
    ids.map((eventId) => ({ name: 'system.probe', data: { eventId, schemaVersion: 1 } })),
    'PRIVATE_RETAINED_PROBE',
  );
  const response = await admin.http.raw('/api/v1/admin/tasks?category=system');
  expect(response.status).toBe(200);
  const body = AdminTaskListResponseSchema.parse(await response.json());
  expect(body.meta).toMatchObject({
    total: 500,
    queueObservation: {
      status: 'partial',
      retainedFailed: 501,
      inspected: 500,
      unverifiable: 0,
      limit: 500,
    },
  });
  expect(body.data).toHaveLength(20);
  expect(
    body.data.every(
      (row) => row.source === 'queue' && row.stage === 'execution' && row.executionAttempts === 1,
    ),
  ).toBe(true);
  expect(JSON.stringify(body)).not.toContain('PRIVATE_RETAINED_PROBE');
});

it('Redis观测连接不可用时仍返回数据库已知失败，并明确未知保留数量', async () => {
  const admin = await administrator();
  await stack.owner.pool.query(
    "INSERT INTO outbox_events(topic,payload,attempts) VALUES('system.probe','{\"schemaVersion\":1}',5)",
  );
  const original = stack.env.REDIS_URL;
  // 只替换本用例API新建的观测连接，认证限流和Worker已有连接继续使用隔离Redis
  stack.env.REDIS_URL = 'redis://127.0.0.1:1/0';
  try {
    const response = await admin.http.raw('/api/v1/admin/tasks?category=system');
    expect(response.status).toBe(200);
    const body = AdminTaskListResponseSchema.parse(await response.json());
    expect(body.meta).toMatchObject({
      total: 1,
      queueObservation: {
        status: 'unavailable',
        retainedFailed: null,
        inspected: 0,
        unverifiable: 0,
      },
    });
    expect(body.data).toEqual([expect.objectContaining({ source: 'dispatch', stage: 'dispatch' })]);
  } finally {
    stack.env.REDIS_URL = original;
  }
});

it('系统执行回执优先于旧队列失败，完成后不会重新列为待处理', async () => {
  const admin = await administrator();
  await prepareLegacyQueue();
  const eventId = randomUUID();
  await stack.owner.pool.query(
    "INSERT INTO outbox_events(id,topic,payload,delivered_at) VALUES($1,'system.probe','{\"schemaVersion\":1}',now())",
    [eventId],
  );
  await stack.owner.pool.query(
    "INSERT INTO processed_events(event_id,consumer) VALUES($1,'system')",
    [eventId],
  );
  await legacyFailures(
    [{ name: 'system.probe', data: { eventId, schemaVersion: 1 } }],
    'PRIVATE_SYSTEM_ERROR',
  );
  const response = await admin.http.raw('/api/v1/admin/tasks?category=system');
  expect(response.status).toBe(200);
  expect(AdminTaskListResponseSchema.parse(await response.json())).toMatchObject({
    data: [],
    meta: { total: 0, queueObservation: { status: 'ready', retainedFailed: 1 } },
  });
});

it('保留执行证据改变显示次数时同时改变业务版本，大小写引用仍只计一个业务对象', async () => {
  const admin = await administrator();
  await prepareLegacyQueue();
  const account = z
    .object({ data: z.object({ account: z.object({ id: z.uuid() }) }) })
    .parse(await (await admin.http.raw('/api/v1/auth/context')).json()).data.account;
  const jobId = randomUUID(),
    eventId = randomUUID();
  await stack.owner.pool.query(
    "INSERT INTO asset_jobs(id,owner_id,source_url,status,error_code) VALUES($1,$2,'https://private-fixture.invalid/image.png','failed','IMAGE_IMPORT_FAILED')",
    [jobId, account.id],
  );
  await stack.owner.pool.query(
    "INSERT INTO outbox_events(id,topic,payload,delivered_at) VALUES($1,'asset.import',$2::jsonb,now())",
    [eventId, JSON.stringify({ schemaVersion: 1, jobId: jobId.toUpperCase() })],
  );
  const beforeResponse = await admin.http.raw('/api/v1/admin/tasks?category=images');
  expect(beforeResponse.status).toBe(200);
  const before = AdminTaskListResponseSchema.parse(await beforeResponse.json());
  expect(before).toMatchObject({
    data: [{ id: jobId, executionAttempts: null }],
    meta: { total: 1 },
  });
  await legacyFailures(
    [{ name: 'asset.import', data: { eventId, schemaVersion: 1, jobId: jobId.toUpperCase() } }],
    'PRIVATE_IMAGE_ERROR',
  );
  const response = await admin.http.raw('/api/v1/admin/tasks?category=images');
  expect(response.status).toBe(200);
  const after = AdminTaskListResponseSchema.parse(await response.json());
  expect(after).toMatchObject({
    data: [{ source: 'image', id: jobId, executionAttempts: 1 }],
    meta: { total: 1 },
  });
  expect(after.data[0]?.version).not.toBe(before.data[0]?.version);
});

it('长期遗留sending仅作为结果待确认展示，不猜测已发送且不能泄漏私有密文', async () => {
  const admin = await administrator(),
    input = await mailInput(),
    { eventId, ...payload } = input.data;
  await stack.owner.pool.query(
    "INSERT INTO mail_deliveries(event_id,status,payload_hash,attempted_at) VALUES($1,'sending',$2,now()-interval '10 minutes')",
    [eventId, createHash('sha256').update(JSON.stringify(payload)).digest('hex')],
  );
  const response = await admin.http.raw('/api/v1/admin/tasks?category=mail&stage=uncertain');
  expect(response.status).toBe(200);
  const body = AdminTaskListResponseSchema.parse(await response.json());
  expect(body.meta.total).toBe(1);
  expect(body.data).toEqual([
    expect.objectContaining({
      source: 'mail',
      id: eventId,
      stage: 'uncertain',
      errorCode: 'MAIL_RESULT_UNCERTAIN',
      executionAttempts: 1,
    }),
  ]);
  expect(JSON.stringify(body)).not.toContain(input.data.encryptedMessage);
});

it('旧消费者保留的真实队列失败无投递账本时按待确认列出，不返回原始错误', async () => {
  const admin = await administrator();
  await prepareLegacyQueue();
  const input = await mailInput();
  await legacyFailure(input);
  expect(
    (
      await stack.owner.pool.query('SELECT 1 FROM mail_deliveries WHERE event_id=$1', [
        input.data.eventId,
      ])
    ).rowCount,
  ).toBe(0);
  const response = await admin.http.raw('/api/v1/admin/tasks?category=mail');
  expect(response.status).toBe(200);
  const body = AdminTaskListResponseSchema.parse(await response.json());
  expect(body.meta.total).toBe(1);
  expect(body.data).toEqual([
    expect.objectContaining({
      source: 'mail',
      id: input.data.eventId,
      stage: 'uncertain',
      errorCode: 'MAIL_RESULT_UNCERTAIN',
      executionAttempts: 1,
    }),
  ]);
  expect(body.meta).toMatchObject({ queueObservation: { status: 'ready' } });
  expect(JSON.stringify(body)).not.toContain(input.marker);
});

it('队列保留失败不覆盖已确认送达的数据库事实，同事件不重新计入待处理', async () => {
  const admin = await administrator();
  await prepareLegacyQueue();
  const input = await mailInput(),
    database = createDatabase(stack.env.DATABASE_URL),
    sender = new MailSender(stack.env);
  try {
    await expect(
      deliverMail(database, input.data, { sender, encryptionKey: stack.env.APP_ENCRYPTION_KEY }),
    ).resolves.toBe('delivered');
  } finally {
    sender.close();
    await database.close();
  }
  await legacyFailure(input);
  const response = await admin.http.raw('/api/v1/admin/tasks?category=mail');
  expect(response.status).toBe(200);
  expect(AdminTaskListResponseSchema.parse(await response.json())).toMatchObject({
    data: [],
    meta: { total: 0, queueObservation: { status: 'ready', retainedFailed: 1 } },
  });
});

it('保留队列数据与Outbox契约不符时显示部分观测，不把遗漏伪装成完整零结果', async () => {
  const admin = await administrator();
  await prepareLegacyQueue();
  const input = await mailInput();
  await legacyFailure(input, true);
  const response = await admin.http.raw('/api/v1/admin/tasks?category=mail');
  expect(response.status).toBe(200);
  const body = AdminTaskListResponseSchema.parse(await response.json());
  expect(body.meta).toMatchObject({
    queueObservation: { status: 'partial', retainedFailed: 1, unverifiable: 1 },
  });
  expect(JSON.stringify(body)).not.toContain(input.marker);
});
