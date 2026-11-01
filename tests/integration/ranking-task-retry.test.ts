import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminRankingGenerationResponseSchema,
  AdminRankingRetryReceiptResponseSchema,
  AdminRankingRetryResponseSchema,
  ErrorResponseSchema,
  RankingListResponseSchema,
  defaultRankingSettings,
  RankingSettingsResponseSchema,
  AdminTaskListResponseSchema,
  RankingRefreshJobSchema,
} from '@personamarket/contracts';
import {
  buildRankingGeneration,
  contentHash,
  createAdministrator,
  createSystemQueue,
  enqueueConfiguredRankingRefresh,
  enqueueRankingRefresh,
  recordRankingFailure,
} from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
  // 正常真实Worker诊断，只记录白名单错误字段，不输出SQL/payload/地址或认证资料。
  stack.worker.on('failed', (job, cause) => {
    console.error(
      JSON.stringify({
        event: 'ranking-normal-worker-failed',
        topic: safeTopic(job?.name),
        eventId: safeUuid(job?.id),
        attemptsMade: job?.attemptsMade,
        errors: safeErrors(cause),
      }),
    );
  });
  stack.worker.on('error', (cause) =>
    console.error(
      JSON.stringify({ event: 'ranking-normal-worker-error', errors: safeErrors(cause) }),
    ),
  );
});
afterEach(async () => {
  await stack?.close();
});
const path = (id: string) => '/api/v1/admin/rankings/generations/' + id;
const safeUuid = (value: unknown) =>
  typeof value === 'string' && /^[a-f0-9-]{36}$/iu.test(value) ? value : undefined;
const safeTopic = (value: unknown) =>
  typeof value === 'string' &&
  [
    'rankings.refresh',
    'auth.email',
    'notification.deliver',
    'storage.cleanup',
    'asset.import',
    'market.image',
    'system.bootstrap',
    'system.probe',
  ].includes(value)
    ? value
    : 'unrecognized';
function safeErrors(input: unknown) {
  const result: Record<string, string>[] = [];
  let current = input;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    const row: Record<string, string> = {
      name: /^[A-Za-z]{1,64}$/u.test(current.name) ? current.name : 'Error',
      messageSha256: createHash('sha256').update(current.message).digest('hex'),
    };
    if (/^[A-Z][A-Z0-9_]{0,63}$/u.test(current.message)) row['messageCode'] = current.message;
    for (const field of ['code', 'constraint', 'table', 'column'] as const) {
      if (field in current) {
        const value = Reflect.get(current, field);
        if (typeof value === 'string' && /^[A-Za-z0-9_]{1,96}$/u.test(value)) row[field] = value;
      }
    }
    result.push(row);
    current = current.cause;
  }
  return result;
}
async function diagnoseOwnedWorker(id: string) {
  let queue: ReturnType<typeof createSystemQueue> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const rows = (
      await stack.owner.pool.query<{ id: string; topic: string }>(
        "SELECT id,topic FROM outbox_events WHERE (topic='rankings.refresh' AND payload->>'generationId'=$1) OR topic='auth.email' ORDER BY created_at,id LIMIT 8",
        [id],
      )
    ).rows;
    const generation = (
      await stack.owner.pool.query<Record<string, unknown>>(
        "SELECT g.id,g.status,g.attempts,g.error_code,g.current_event_id,r.state AS run_state,r.execution_attempts,r.terminal_proof,(SELECT count(*)::int FROM ranking_boards b WHERE b.generation_id=g.id) boards,(SELECT count(*)::int FROM processed_events p WHERE p.consumer='rankings' AND p.event_id=g.current_event_id) current_receipts FROM ranking_generations g LEFT JOIN ranking_generation_runs r ON r.event_id=g.current_event_id WHERE g.id=$1",
        [id],
      )
    ).rows;
    const mail = (
      await stack.owner.pool.query<Record<string, unknown>>(
        "SELECT m.event_id,m.status,m.attempts,m.error_code,(SELECT count(*)::int FROM processed_events p WHERE p.consumer='auth-email' AND p.event_id=m.event_id) receipts FROM mail_deliveries m ORDER BY m.event_id LIMIT 8",
      )
    ).rows;
    const observer = createSystemQueue(stack.env.REDIS_URL, stack.env.QUEUE_NAME);
    queue = observer;
    const jobs = await Promise.race([
      (async () => {
        await observer.waitUntilReady();
        const states = [];
        for (const row of rows) {
          const job = await observer.getJob(row.id);
          states.push({
            eventId: row.id,
            topic: safeTopic(row.topic),
            state: job ? await job.getState() : 'missing',
            attemptsMade: job?.attemptsMade ?? null,
            automaticAttemptLimit: job?.opts.attempts ?? null,
            failure: job?.failedReason ? safeErrors(new Error(job.failedReason)) : [],
          });
        }
        return states;
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(Error('OWNED_DIAGNOSTIC_UNAVAILABLE')), 3000);
      }),
    ]);
    console.error(
      JSON.stringify({
        event: 'ranking-normal-owned-state',
        generation,
        mail,
        jobs,
        scope: 'this test-owned database and queue only; no SQL activity or payload read',
      }),
    );
  } catch (cause) {
    console.error(
      JSON.stringify({ event: 'ranking-normal-diagnostic-unavailable', errors: safeErrors(cause) }),
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    await queue?.disconnect().catch(() => undefined);
    await queue?.close().catch(() => undefined);
  }
}
async function admin() {
  const username = 'rank_retry_' + randomUUID().replaceAll('-', '').slice(0, 10);
  const password = 'Ranking retry normal fixture passphrase 2026';
  await createAdministrator(stack.owner, {
    username,
    password,
    email: username + '@fixture.invalid',
  });
  const http = stack.browser();
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=NULL WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [username],
  );
  return http;
}
async function detail(http: AuthHttp, id: string) {
  const response = await http.raw(path(id));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return AdminRankingGenerationResponseSchema.parse(await response.json()).data;
}
async function failed(
  algorithm: 'exports-v1' | 'interactions-v1' | 'interactions-v2' = 'interactions-v2',
) {
  let id: string;
  if (algorithm === 'exports-v1') {
    id = randomUUID();
    await stack.owner.pool.query(
      "INSERT INTO ranking_generations(id,request_key,algorithm,status,attempts,error_code) VALUES($1,$2,'exports-v1','failed',5,'RANKING_BUILD_FAILED')",
      [id, 'legacy-fixture:' + id],
    );
    await stack.owner.pool.query(
      "INSERT INTO outbox_events(topic,payload,attempts) VALUES('rankings.refresh',jsonb_build_object('generationId',$1::text),5)",
      [id],
    );
  } else {
    const generated =
      algorithm === 'interactions-v2'
        ? await enqueueConfiguredRankingRefresh(stack.owner, 'manual')
        : await enqueueRankingRefresh(stack.owner, 'manual');
    if (!generated) throw Error('missing generation fixture');
    id = generated;
    // 合法、隔离、有界的派发耗尽夹具；不制造依赖故障或拒绝trigger。
    await stack.owner.pool.query(
      'UPDATE outbox_events SET attempts=5,lease_until=NULL WHERE id=(SELECT current_event_id FROM ranking_generations WHERE id=$1)',
      [id],
    );
  }
  return id;
}
const command = (version: string) => ({
  expectedVersion: version,
  reason: '核对同一原批次的终态后恢复',
  confirmed: true as const,
});
async function retry(
  http: AuthHttp,
  id: string,
  body?: ReturnType<typeof command>,
  key = randomUUID(),
) {
  const input = body ?? command((await detail(http, id)).version);
  return {
    response: await http.write(path(id) + '/retry', input, 'POST', { 'Idempotency-Key': key }),
    key,
    body: input,
  };
}
async function receipt(http: AuthHttp, id: string, key: string, body: ReturnType<typeof command>) {
  const response = await http.raw(path(id) + '/retry-receipt', {
    headers: { 'Idempotency-Key': key, 'X-Retry-Request-Hash': contentHash({ id, ...body }) },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return AdminRankingRetryReceiptResponseSchema.parse(await response.json()).data;
}
async function facts(id: string) {
  return (
    await stack.owner.pool.query(
      `SELECT (SELECT count(*)::int FROM outbox_events WHERE topic='rankings.refresh' AND payload->>'generationId'=$1) events,(SELECT count(*)::int FROM admin_task_retries WHERE source='ranking' AND task_id=$1::uuid) retries,(SELECT count(*)::int FROM idempotency_keys WHERE operation='ranking.generation.retry') receipts,(SELECT count(*)::int FROM auth_audit_events WHERE event='admin.ranking_retried') audit`,
      [id],
    )
  ).rows[0];
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(code);
}
/** 真实管理员/原事件的有界历史夹具；不是实际运营记录，不等待或改写不可变审计。 */
async function priorRounds(http: AuthHttp, id: string, count: 1 | 2) {
  const actorId = (await http.context()).data.account?.id;
  if (!actorId) throw Error('missing fixture administrator');
  const connection = await stack.owner.pool.connect();
  try {
    await connection.query('BEGIN');
    let previous = (
      await connection.query<{ current_event_id: string }>(
        'SELECT current_event_id FROM ranking_generations WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0]?.current_event_id;
    if (!previous) throw Error('missing fixture baseline event');
    await connection.query(
      "UPDATE ranking_generation_runs SET state='failed',last_error_code='RANKING_DISPATCH_EXHAUSTED',terminal_proof='dispatch_exhausted',terminal_observed_at=clock_timestamp() WHERE event_id=$1",
      [previous],
    );
    await connection.query(
      "UPDATE ranking_generations SET status='failed',error_code='RANKING_DISPATCH_EXHAUSTED' WHERE id=$1",
      [id],
    );
    for (let round = 1; round <= count; round++) {
      const eventId = randomUUID();
      await connection.query(
        "INSERT INTO outbox_events(id,topic,payload,attempts) VALUES($1,'rankings.refresh',jsonb_build_object('generationId',$2::text),5)",
        [eventId, id],
      );
      await connection.query(
        "INSERT INTO ranking_generation_runs(generation_id,event_id,manual_round,origin,state,last_error_code,terminal_proof,terminal_observed_at) VALUES($1,$2,$3,'manual_retry','failed','RANKING_DISPATCH_EXHAUSTED','dispatch_exhausted',clock_timestamp())",
        [id, eventId, round],
      );
      await connection.query(
        "INSERT INTO admin_task_retries(source,task_id,event_id,previous_event_id,actor_id,attempt,expected_version,reason,created_at) VALUES('ranking',$1,$2,$3,$4,$5,$6,'明确标识的隔离人工历史夹具',clock_timestamp()-make_interval(secs=>$7))",
        [
          id,
          eventId,
          previous,
          actorId,
          round,
          contentHash({ fixture: id, round }),
          120 + (count - round) * 60,
        ],
      );
      await connection.query(
        "UPDATE ranking_generations SET current_event_id=$2,status='pending',error_code=NULL WHERE id=$1",
        [id, eventId],
      );
      await connection.query(
        "UPDATE ranking_generations SET status='failed',error_code='RANKING_DISPATCH_EXHAUSTED' WHERE id=$1",
        [id],
      );
      previous = eventId;
    }
    await connection.query('COMMIT');
  } catch (cause) {
    await connection.query('ROLLBACK');
    throw cause;
  } finally {
    connection.release();
  }
}

/** 所有实际Worker场景共用同一终态协议，不把自动重试中的瞬时状态当最终结果。 */
async function awaitRealRankingWorker(http: AuthHttp, id: string) {
  const queued = await detail(http, id),
    eventId = queued.run?.eventId;
  if (!eventId) throw Error('missing accepted current ranking event');
  type ObservedJob = {
    id?: string | undefined;
    name: string;
    data: unknown;
    attemptsMade: number;
    opts: { attempts?: number | undefined };
    getState(): Promise<string>;
  };
  const matches = (job: ObservedJob | undefined): job is ObservedJob => {
    if (!job || job.id !== eventId || job.name !== 'rankings.refresh') return false;
    const data = RankingRefreshJobSchema.safeParse(job.data);
    return data.success && data.data.eventId === eventId && data.data.generationId === id;
  };
  let dispose: () => void = () => undefined;
  // 先订阅实际新事件再分发；只沿原15秒case总预算，不另加timeout或sleep。
  const finished = new Promise<{ attemptsMade: number; limit: number | undefined }>(
    (resolve, reject) => {
      const completed = (job: ObservedJob) => {
        if (matches(job)) resolve({ attemptsMade: job.attemptsMade, limit: job.opts.attempts });
      };
      const failed = (job: ObservedJob | undefined) => {
        if (!matches(job)) return;
        void job.getState().then(
          (state) => {
            if (state === 'failed') reject(Error('OWNED_RANKING_WORKER_TERMINAL_FAILURE'));
          },
          () => reject(Error('OWNED_RANKING_WORKER_STATE_UNAVAILABLE')),
        );
      };
      const closing = () => reject(Error('OWNED_RANKING_WORKER_CLOSED_BEFORE_TERMINAL'));
      dispose = () => {
        stack.worker.off('completed', completed);
        stack.worker.off('failed', failed);
        stack.worker.off('closing', closing);
      };
      stack.worker.on('completed', completed);
      stack.worker.on('failed', failed);
      stack.worker.on('closing', closing);
    },
  );
  void finished.catch(() => undefined);
  try {
    await stack.tick();
    const actual = await finished;
    expect(actual.limit).toBe(5);
    expect(Number.isInteger(actual.attemptsMade)).toBe(true);
    expect(actual.attemptsMade).toBeGreaterThanOrEqual(1);
    expect(actual.attemptsMade).toBeLessThanOrEqual(5);
    const completed = await detail(http, id);
    expect(completed.completion.state).toBe('verified');
    expect(completed.run).toMatchObject({
      eventId,
      manualRound: 1,
      state: 'completed',
      currentEventProcessed: true,
      terminalProof: 'worker_completed',
      executionAttempts: actual.attemptsMade,
    });
    return completed;
  } catch (cause) {
    await diagnoseOwnedWorker(id);
    throw cause;
  } finally {
    dispose();
  }
}

it.each([
  ['exports-v1', 18],
  ['interactions-v1', 36],
  ['interactions-v2', 39],
] as const)(
  '同一%s批次恢复经真实Worker生成完整%i块榜板，冻结身份不变',
  async (algorithm, boards) => {
    const http = await admin(),
      id = await failed(algorithm);
    const before = (
      await stack.owner.pool.query(
        'SELECT id,request_key,algorithm,settings_revision,definition,requested_at FROM ranking_generations WHERE id=$1',
        [id],
      )
    ).rows[0];
    const first = await detail(http, id);
    expect(first.retry.allowed).toBe(true);
    // managed轮次的真实NULL不能被??吞掉后回退到不存在的legacy分支。
    expect(first.run ? first.run.executionAttempts : first.legacy?.executionAttempts).toBeNull();
    const result = await retry(http, id);
    expect(result.response.status).toBe(200);
    expect(AdminRankingRetryResponseSchema.parse(await result.response.json()).data).toEqual({
      generationId: id,
      accepted: true,
    });
    expect((await receipt(http, id, result.key, result.body)).recorded).toBe(true);
    const completed = await awaitRealRankingWorker(http, id);
    expect(completed.completion).toEqual({
      state: 'verified',
      expectedBoards: boards,
      actualBoards: boards,
    });
    expect(
      (
        await stack.owner.pool.query(
          'SELECT id,request_key,algorithm,settings_revision,definition,requested_at FROM ranking_generations WHERE id=$1',
          [id],
        )
      ).rows[0],
    ).toEqual(before);
    const publicResult = await stack.browser().raw('/api/v1/rankings?snapshotId=' + id);
    expect(publicResult.status).toBe(200);
    expect(RankingListResponseSchema.parse(await publicResult.json()).meta.snapshotId).toBe(id);
  },
);

it('并发同版本只有一次受理；原key重放和回执无副作用，异载荷不接受', async () => {
  const http = await admin(),
    id = await failed(),
    body = command((await detail(http, id)).version);
  const [a, b] = await Promise.all([retry(http, id, body), retry(http, id, body)]);
  expect([a.response.status, b.response.status].sort()).toEqual([200, 412]);
  const accepted = a.response.status === 200 ? a : b,
    before = await facts(id);
  expect((await retry(http, id, body, accepted.key)).response.status).toBe(200);
  expect((await receipt(http, id, accepted.key, body)).recorded).toBe(true);
  await error(
    (await retry(http, id, { ...body, reason: '不同载荷不得复用同一个原幂等标识' }, accepted.key))
      .response,
    409,
    'CONFLICT',
  );
  expect(await facts(id)).toEqual(before);
});

it('同key同载荷并发均返回原受理结果且只产生一份事件、审计和回执', async () => {
  const http = await admin(),
    id = await failed(),
    body = command((await detail(http, id)).version),
    key = randomUUID();
  const [a, b] = await Promise.all([retry(http, id, body, key), retry(http, id, body, key)]);
  expect([a.response.status, b.response.status]).toEqual([200, 200]);
  expect(await facts(id)).toEqual({ events: 2, retries: 1, receipts: 1, audit: 1 });
  expect((await receipt(http, id, key, body)).recorded).toBe(true);
});

it('旧failed/5没有精确终态证据、多个候选或部分板时只读拒绝，GET不收养', async () => {
  const http = await admin(),
    id = await failed('exports-v1');
  await stack.owner.pool.query(
    "UPDATE outbox_events SET attempts=0 WHERE payload->>'generationId'=$1",
    [id],
  );
  const before = await facts(id),
    value = await detail(http, id);
  expect(value.run).toBeNull();
  expect(value.retry).toMatchObject({
    allowed: false,
    blockedReason: 'LEGACY_TERMINAL_UNVERIFIABLE',
  });
  await error((await retry(http, id, command(value.version))).response, 409, 'CONFLICT');
  expect(await facts(id)).toEqual(before);
  const tasks = await http.raw('/api/v1/admin/tasks?category=rankings');
  expect(tasks.status).toBe(200);
  expect(
    AdminTaskListResponseSchema.parse(await tasks.json()).data.find((item) => item.id === id)
      ?.executionAttempts,
  ).toBeNull();
  await stack.owner.pool.query(
    "INSERT INTO outbox_events(topic,payload,attempts) VALUES('rankings.refresh',jsonb_build_object('generationId',$1::text),5)",
    [id],
  );
  expect((await detail(http, id)).retry.allowed).toBe(false);
  expect(
    (
      await stack.owner.pool.query(
        'SELECT count(*)::int n FROM ranking_generation_runs WHERE generation_id=$1',
        [id],
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
  const partialId = await failed();
  await stack.owner.pool.query(
    "INSERT INTO ranking_boards(generation_id,kind,\"window\",platform,entry_count,capped) VALUES($1,'hot','7d','all',0,false)",
    [partialId],
  );
  const partial = await detail(http, partialId),
    partialBefore = await facts(partialId);
  expect(partial.retry.blockedReason).toBe('RESULT_INCONSISTENT');
  await error((await retry(http, partialId, command(partial.version))).response, 409, 'CONFLICT');
  expect(await facts(partialId)).toEqual(partialBefore);
});

it('活跃派发租约和payload不匹配保持只读，原专用POST也不能绕过', async () => {
  const http = await admin(),
    id = await failed();
  await stack.owner.pool.query(
    "UPDATE outbox_events SET lease_until=clock_timestamp()+interval '1 minute' WHERE id=(SELECT current_event_id FROM ranking_generations WHERE id=$1)",
    [id],
  );
  const active = await detail(http, id),
    before = await facts(id);
  expect(active.retry.blockedReason).toBe('DISPATCH_LEASE_ACTIVE');
  await error((await retry(http, id, command(active.version))).response, 409, 'CONFLICT');
  await stack.owner.pool.query(
    'UPDATE outbox_events SET lease_until=NULL,payload=payload||\'{"schemaVersion":1}\'::jsonb WHERE id=(SELECT current_event_id FROM ranking_generations WHERE id=$1)',
    [id],
  );
  const mismatched = await detail(http, id);
  expect(mismatched.retry.blockedReason).toBe('CURRENT_EVENT_UNVERIFIABLE');
  await error((await retry(http, id, command(mismatched.version))).response, 409, 'CONFLICT');
  expect(await facts(id)).toEqual(before);
});

it('迟到旧事件与重复消费不改当前轮或当前消费回执', async () => {
  const http = await admin(),
    id = await failed(),
    old = await detail(http, id);
  if (!old.run) throw Error('missing current run');
  expect((await retry(http, id)).response.status).toBe(200);
  const current = await detail(http, id);
  await recordRankingFailure(
    stack.owner,
    id,
    old.run.eventId,
    { number: 5, last: true },
    'RANKING_BUILD_FAILED',
  );
  expect(await detail(http, id)).toMatchObject({
    run: current.run,
    businessStatus: current.businessStatus,
    version: current.version,
  });
  expect(
    await buildRankingGeneration(stack.owner, id, old.run.eventId, { number: 5, last: true }),
  ).toBe(false);
  expect(await detail(http, id)).toMatchObject({
    run: current.run,
    businessStatus: current.businessStatus,
    version: current.version,
  });
  const done = await awaitRealRankingWorker(http, id);
  if (!done.run) throw Error('missing completed run');
  expect(await buildRankingGeneration(stack.owner, id, done.run.eventId)).toBe(false);
  expect((await detail(http, id)).run).toEqual(done.run);
});

it('匿名/普通用户、预期账号变化与不存在批次拒绝；有效管理员过期recent仍可恢复', async () => {
  const http = await admin(),
    id = await failed();
  let ordinary: Awaited<ReturnType<typeof verifiedCreator>>;
  try {
    ordinary = await verifiedCreator(stack);
  } catch (cause) {
    await diagnoseOwnedWorker(id);
    throw cause;
  }
  await error(await stack.browser().raw(path(id)), 401, 'UNAUTHENTICATED');
  await error(await ordinary.http.raw(path(id)), 403, 'FORBIDDEN');
  await error(
    await http.raw(path(id), { headers: { 'X-Expected-Account': randomUUID() } }),
    409,
    'CONFLICT',
  );
  await error(await http.raw(path(randomUUID())), 404, 'NOT_FOUND');
  expect((await retry(http, id)).response.status).toBe(200);
});

it('同generation60秒冷却与三轮上限真实生效，均不阻断原key核对或成功重放', async () => {
  const http = await admin(),
    coolingId = await failed(),
    first = await retry(http, coolingId);
  expect(first.response.status).toBe(200);
  await stack.owner.pool.query(
    'UPDATE outbox_events SET attempts=5 WHERE id=(SELECT current_event_id FROM ranking_generations WHERE id=$1)',
    [coolingId],
  );
  const cooling = await detail(http, coolingId);
  expect(cooling.retry.blockedReason).toBe('COOLDOWN_ACTIVE');
  await error(
    (await retry(http, coolingId, command(cooling.version))).response,
    429,
    'RATE_LIMITED',
  );
  expect((await receipt(http, coolingId, first.key, first.body)).recorded).toBe(true);
  const limitedId = await failed();
  await priorRounds(http, limitedId, 2);
  const third = await retry(http, limitedId);
  expect(third.response.status).toBe(200);
  await stack.owner.pool.query(
    'UPDATE outbox_events SET attempts=5 WHERE id=(SELECT current_event_id FROM ranking_generations WHERE id=$1)',
    [limitedId],
  );
  const limited = await detail(http, limitedId),
    before = await facts(limitedId);
  expect(limited.retry).toMatchObject({
    blockedReason: 'MANUAL_LIMIT_REACHED',
    recordedManualRound: 3,
  });
  await error((await retry(http, limitedId, command(limited.version))).response, 409, 'CONFLICT');
  expect((await retry(http, limitedId, third.body, third.key)).response.status).toBe(200);
  expect((await receipt(http, limitedId, third.key, third.body)).recorded).toBe(true);
  expect(await facts(limitedId)).toEqual(before);
});

it('真实10/60写预算耗尽返回429后GET回执仍可核对，事件/审计/幂等唯一', async () => {
  const http = await admin(),
    id = await failed(),
    first = await retry(http, id);
  expect(first.response.status).toBe(200);
  const before = await facts(id);
  for (let replay = 0; replay < 9; replay++)
    expect((await retry(http, id, first.body, first.key)).response.status).toBe(200);
  await error((await retry(http, id, first.body, first.key)).response, 429, 'RATE_LIMITED');
  expect((await receipt(http, id, first.key, first.body)).recorded).toBe(true);
  expect(await facts(id)).toEqual(before);
});

it('批次裁剪后保留原命令可核验回执；同key成功重放不伪造当前业务详情', async () => {
  const http = await admin(),
    id = await failed(),
    first = await retry(http, id);
  expect(first.response.status).toBe(200);
  // 仅本轮隔离库模拟正常裁剪后的对象缺失，不改写原审计和幂等记录。
  await stack.owner.pool.query('DELETE FROM ranking_generations WHERE id=$1', [id]);
  await error(await http.raw(path(id)), 404, 'NOT_FOUND');
  expect((await receipt(http, id, first.key, first.body)).recorded).toBe(true);
  expect((await retry(http, id, first.body, first.key)).response.status).toBe(200);
});

it('恢复保持旧冻结修订，先完成的新配置批次仍是默认公开结果', async () => {
  const adminFixture = await stack.admin(),
    id = await failed();
  const change = await adminFixture.http.write(
    '/api/v1/admin/settings/rankings',
    { data: { ...defaultRankingSettings, entryLimit: 7 }, reason: '验证恢复旧批次不覆盖新配置' },
    'PATCH',
    { 'If-Match': '"rankings-1"', 'Idempotency-Key': randomUUID() },
  );
  expect(change.status).toBe(200);
  expect(RankingSettingsResponseSchema.parse(await change.json()).meta.revision).toBe(2);
  const newer = (
    await stack.owner.pool.query<{ id: string; current_event_id: string }>(
      'SELECT id,current_event_id FROM ranking_generations WHERE settings_revision=2 ORDER BY requested_at DESC LIMIT 1',
    )
  ).rows[0];
  if (!newer) throw Error('missing newer frozen generation');
  await buildRankingGeneration(stack.owner, newer.id, newer.current_event_id);
  expect((await retry(adminFixture.http, id)).response.status).toBe(200);
  await awaitRealRankingWorker(adminFixture.http, id);
  expect((await detail(adminFixture.http, id)).definition?.settingsRevision).toBe(1);
  const response = await stack.browser().raw('/api/v1/rankings');
  expect(RankingListResponseSchema.parse(await response.json()).meta.snapshotId).toBe(newer.id);
});
