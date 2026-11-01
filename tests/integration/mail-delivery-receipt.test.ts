import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import { MailJobSchema } from '@personamarket/contracts';
import { createDatabase } from '@personamarket/database';
import {
  createLogger,
  createSystemQueue,
  createSystemWorker,
  deliverMail,
  enqueueMail,
  MailSender,
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
function fixtureQueue() {
  if (!stack.worker.name.startsWith('auth-case-')) throw Error('只允许夹具专属邮件队列');
  return createSystemQueue(stack.env.REDIS_URL, stack.worker.name);
}
async function mailInput() {
  const recipient = 'receipt-' + randomUUID() + '@fixture.invalid';
  await stack.owner.db.transaction((tx) =>
    enqueueMail(tx, stack.env.APP_ENCRYPTION_KEY, {
      to: recipient,
      subject: '隔离邮件投递一致性检查',
      text: '受控测试内容，不含登录或验证凭据',
    }),
  );
  const row = (
    await stack.owner.pool.query<{ id: string; payload: unknown }>(
      "SELECT id,payload FROM outbox_events WHERE topic='auth.email' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0];
  if (!row) throw Error('缺少真实邮件Outbox');
  return {
    recipient,
    data: MailJobSchema.parse({
      eventId: row.id,
      ...z.record(z.string(), z.unknown()).parse(row.payload),
    }),
  };
}
async function received(recipient: string) {
  const origin = process.env['MAILPIT_API_ORIGIN'] ?? 'http://127.0.0.1:18025';
  const reply = await fetch(
    origin + '/api/v1/search?query=' + encodeURIComponent('to:' + recipient),
    { signal: AbortSignal.timeout(3000) },
  );
  if (!reply.ok) throw Error('隔离邮件查询失败');
  const result = z
    .object({ messages: z.array(z.object({ To: z.array(z.object({ Address: z.string() })) })) })
    .parse(await reply.json());
  return result.messages.filter((mail) =>
    mail.To.some((to) => to.Address.toLowerCase() === recipient.toLowerCase()),
  ).length;
}

async function withProbe<T>(
  options: Parameters<typeof createSmtpProbe>[0],
  action: (context: {
    database: ReturnType<typeof createDatabase>;
    sender: MailSender;
    probe: Awaited<ReturnType<typeof createSmtpProbe>>;
  }) => Promise<T>,
) {
  const probe = await createSmtpProbe(options),
    database = createDatabase(stack.env.DATABASE_URL);
  const sender = new MailSender({ ...stack.env, SMTP_PORT: probe.port });
  try {
    return await action({ probe, database, sender });
  } finally {
    sender.close();
    await database.close();
    await probe.close();
  }
}

async function state(eventId: string) {
  return (
    await stack.owner.pool.query(
      'SELECT status,attempts,error_code FROM mail_deliveries WHERE event_id=$1',
      [eventId],
    )
  ).rows[0];
}

it('正常邮件通过实际SMTP送达，同一事件重复处理仅保留一份邮件', async () => {
  const input = await mailInput(),
    queue = fixtureQueue();
  try {
    await stack.tick();
    const started = performance.now();
    try {
      await expect
        .poll(async () => (await queue.getJob(input.data.eventId))?.getState())
        .toBe('completed');
    } catch (cause) {
      const job = await queue.getJob(input.data.eventId);
      mkdirSync('.development/evidence/mail-delivery', { recursive: true });
      writeFileSync(
        '.development/evidence/mail-delivery/normal-failure-' +
          new Date().toISOString().replaceAll(/[:.]/g, '-') +
          '.json',
        JSON.stringify(
          {
            at: new Date().toISOString(),
            milliseconds: Math.round(performance.now() - started),
            state: await job?.getState(),
            attemptsMade: job?.attemptsMade,
            failedReason: job?.failedReason,
            delivery: (
              await stack.owner.pool.query(
                'SELECT status,attempts,error_code,attempted_at,completed_at FROM mail_deliveries WHERE event_id=$1',
                [input.data.eventId],
              )
            ).rows,
            activity: (
              await stack.owner.pool.query(
                'SELECT state,wait_event_type,wait_event,extract(epoch FROM now()-query_start) AS seconds FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()',
              )
            ).rows,
          },
          null,
          2,
        ),
        { flag: 'wx' },
      );
      throw cause;
    }
    expect(await received(input.recipient)).toBe(1);
    const duplicate = await queue.add('auth.email', input.data, {
      jobId: randomUUID(),
      attempts: 5,
    });
    await expect.poll(() => duplicate.getState()).toBe('completed');
    expect(await received(input.recipient)).toBe(1);
    const receipts = await stack.owner.pool.query(
      "SELECT 1 FROM processed_events WHERE consumer='auth-email' AND event_id=$1",
      [input.data.eventId],
    );
    expect(receipts.rowCount).toBe(1);
    expect(
      (
        await stack.owner.pool.query(
          'SELECT status,attempts,error_code FROM mail_deliveries WHERE event_id=$1',
          [input.data.eventId],
        )
      ).rows,
    ).toEqual([{ status: 'sent', attempts: 1, error_code: null }]);
    const appDatabase = createDatabase(stack.env.DATABASE_URL);
    try {
      await expect(
        appDatabase.pool.query(
          "UPDATE mail_deliveries SET status='sending',completed_at=NULL WHERE event_id=$1",
          [input.data.eventId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        appDatabase.pool.query('DELETE FROM mail_deliveries WHERE event_id=$1', [
          input.data.eventId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        appDatabase.pool.query(
          'UPDATE outbox_events SET payload=payload||\'{"changed":true}\'::jsonb WHERE id=$1',
          [input.data.eventId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await appDatabase.close();
    }
  } finally {
    await queue.close();
  }
});

it('SMTP接收后确认应答丢失视为结果不确定，CONN断线也不能触发自动重发', async () => {
  const input = await mailInput();
  await withProbe({ dropAcceptance: true }, async ({ probe, database, sender }) => {
    const configuration = { sender, encryptionKey: stack.env.APP_ENCRYPTION_KEY };
    await expect(deliverMail(database, input.data, configuration)).rejects.toThrow(
      'MAIL_RESULT_UNCERTAIN',
    );
    expect(probe.observations).toMatchObject({ submitted: 1, accepted: 1, tlsAttempts: 0 });
    expect(await state(input.data.eventId)).toEqual({
      status: 'uncertain',
      attempts: 1,
      error_code: 'MAIL_RESULT_UNCERTAIN',
    });
    await expect(deliverMail(database, input.data, configuration)).rejects.toThrow(
      'MAIL_RESULT_UNCERTAIN',
    );
    expect(probe.observations.accepted).toBe(1);
    expect(await received(input.recipient)).toBe(1);
  });
});

it('持久sending记录在前一会话中断后只能转待确认，不能当作未发送恢复', async () => {
  const input = await mailInput(),
    { eventId, ...payload } = input.data;
  await stack.owner.pool.query(
    "INSERT INTO mail_deliveries(event_id,status,payload_hash) VALUES($1,'sending',$2)",
    [eventId, createHash('sha256').update(JSON.stringify(payload)).digest('hex')],
  );
  await withProbe({}, async ({ probe, database, sender }) => {
    await expect(
      deliverMail(database, input.data, { sender, encryptionKey: stack.env.APP_ENCRYPTION_KEY }),
    ).rejects.toThrow('MAIL_RESULT_UNCERTAIN');
    expect(probe.observations.connections).toBe(0);
    expect(await state(eventId)).toEqual({
      status: 'uncertain',
      attempts: 1,
      error_code: 'MAIL_RESULT_UNCERTAIN',
    });
    await expect(
      database.pool.query(
        "UPDATE mail_deliveries SET status='failed',error_code='MAIL_SEND_FAILED' WHERE event_id=$1",
        [eventId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

it('确认未建立SMTP连接的配置失败保留五次有限尝试，耗尽后不能通过新队列标识重置', async () => {
  const input = await mailInput(),
    database = createDatabase(stack.env.DATABASE_URL);
  const sender = new MailSender(stack.env, async () => undefined);
  try {
    const configuration = { sender, encryptionKey: stack.env.APP_ENCRYPTION_KEY };
    for (let attempt = 1; attempt <= 5; attempt++) {
      await expect(deliverMail(database, input.data, configuration)).rejects.toThrow(
        'MAIL_DELIVERY_FAILED',
      );
      expect(await state(input.data.eventId)).toEqual({
        status: 'failed',
        attempts: attempt,
        error_code: 'MAIL_NOT_CONFIGURED',
      });
    }
    await expect(deliverMail(database, input.data, configuration)).rejects.toThrow(
      'MAIL_RETRY_EXHAUSTED',
    );
    expect(await received(input.recipient)).toBe(0);
  } finally {
    sender.close();
    await database.close();
  }
});

it('实际SMTP等待应答时并发消费者被数据库锁阻断，发送和回执只发生一次', async () => {
  const input = await mailInput();
  await withProbe({ delayAcceptanceMs: 1000 }, async ({ probe, database, sender }) => {
    const configuration = { sender, encryptionKey: stack.env.APP_ENCRYPTION_KEY };
    const first = deliverMail(database, input.data, configuration);
    await expect.poll(() => probe.observations.accepted).toBe(1);
    await expect(
      deliverMail(
        database,
        { ...input.data, eventId: input.data.eventId.toUpperCase() },
        configuration,
      ),
    ).rejects.toThrow('MAIL_DELIVERY_FAILED');
    await expect(first).resolves.toBe('delivered');
    expect(probe.observations.accepted).toBe(1);
    expect(await state(input.data.eventId)).toEqual({
      status: 'sent',
      attempts: 1,
      error_code: null,
    });
    expect(
      (
        await stack.owner.pool.query(
          "SELECT 1 FROM processed_events WHERE consumer='auth-email' AND event_id=$1",
          [input.data.eventId],
        )
      ).rowCount,
    ).toBe(1);
  });
});

it('实际SMTP已接收而数据库回执失败时，有限队列重试不能再次发送相同邮件', async () => {
  const input = await mailInput(),
    queue = fixtureQueue(),
    probe = await createSmtpProbe(),
    workerDatabase = createDatabase(stack.env.DATABASE_URL),
    sender = new MailSender({ ...stack.env, SMTP_PORT: probe.port });
  await stack.worker.pause();
  const worker = createSystemWorker(
    workerDatabase,
    stack.env.REDIS_URL,
    queue.name,
    createLogger('mail-receipt-probe', 'silent'),
    { sender, encryptionKey: stack.env.APP_ENCRYPTION_KEY },
  );
  try {
    await worker.waitUntilReady();
    await stack.owner.pool.query(
      "CREATE FUNCTION reject_mail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.consumer='auth-email' THEN RAISE EXCEPTION 'CONTROLLED_MAIL_RECEIPT_FAILURE' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$",
    );
    await stack.owner.pool.query(
      'CREATE TRIGGER reject_mail_receipt BEFORE INSERT ON processed_events FOR EACH ROW EXECUTE FUNCTION reject_mail_receipt()',
    );
    // 仅隔离夹具省略退避等待，仍执行真实Worker/SMTP/PG和原五次有限尝试
    const job = await queue.add('auth.email', input.data, {
      jobId: input.data.eventId,
      attempts: 5,
      removeOnFail: false,
    });
    await expect.poll(() => job.getState()).toBe('failed');
    const messages = await received(input.recipient);
    const receiptRows = (
      await stack.owner.pool.query(
        "SELECT 1 FROM processed_events WHERE consumer='auth-email' AND event_id=$1",
        [input.data.eventId],
      )
    ).rowCount;
    mkdirSync('.development/evidence/mail-delivery', { recursive: true });
    writeFileSync(
      '.development/evidence/mail-delivery/receipt-observation-' +
        new Date().toISOString().replaceAll(/[:.]/g, '-') +
        '.json',
      JSON.stringify(
        {
          at: new Date().toISOString(),
          messages,
          receiptRows,
          queueState: await job.getState(),
          attemptsMade: (await queue.getJob(job.id ?? ''))?.attemptsMade,
          realSmtp: 'local Mailpit',
          smtpSubmitted: probe.observations.submitted,
          smtpAccepted: probe.observations.accepted,
          isolated: true,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
    expect(receiptRows).toBe(0);
    expect(messages).toBe(1);
    expect(probe.observations.tlsAttempts).toBe(0);
    expect(probe.observations.accepted).toBe(1);
    const state = (
      await stack.owner.pool.query(
        'SELECT status,attempts,error_code FROM mail_deliveries WHERE event_id=$1',
        [input.data.eventId],
      )
    ).rows;
    expect(state).toEqual([
      { status: 'uncertain', attempts: 1, error_code: 'MAIL_RECEIPT_UNCERTAIN' },
    ]);
    const replay = await queue.add('auth.email', input.data, { jobId: randomUUID(), attempts: 5 });
    await expect.poll(() => replay.getState()).toBe('failed');
    expect(probe.observations.accepted).toBe(1);
    expect(
      (
        await stack.owner.pool.query(
          'SELECT status,attempts,error_code FROM mail_deliveries WHERE event_id=$1',
          [input.data.eventId],
        )
      ).rows,
    ).toEqual(state);
  } finally {
    await worker.close();
    sender.close();
    await workerDatabase.close();
    await probe.close();
    await stack.worker.resume();
    await queue.close();
  }
});

it('同一合法UUID的大写写法仍绑定原邮件事件、加密目的和持久去重身份', async () => {
  const input = await mailInput();
  await withProbe({}, async ({ probe, database, sender }) => {
    const equivalent = { ...input.data, eventId: input.data.eventId.toUpperCase() };
    const configuration = { sender, encryptionKey: stack.env.APP_ENCRYPTION_KEY };
    await expect(deliverMail(database, equivalent, configuration)).resolves.toBe('delivered');
    await expect(deliverMail(database, input.data, configuration)).resolves.toBe('duplicate');
    expect(probe.observations.accepted).toBe(1);
    expect(await state(input.data.eventId)).toEqual({
      status: 'sent',
      attempts: 1,
      error_code: null,
    });
  });
});
