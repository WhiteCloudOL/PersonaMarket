import { moderatePersona } from '../fixtures/admin-persona-moderation.js';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { RankingListResponseSchema, SubmissionResponseSchema } from '@personamarket/contracts';
import {
  enqueueRankingRefresh,
  buildRankingGeneration,
  pruneRankings,
  pruneExportSubjects,
} from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { seedRankingHistory } from '../fixtures/ranking-history.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

async function release(
  http: AuthHttp,
  reviewer: AuthHttp,
  persona: { id: string; revision: number },
  version: string,
) {
  const response = await http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version,
      expectedDraftRevision: persona.revision,
      changelog: '真实排行版本',
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await response.json()).data;
  expect(
    (
      await reviewer.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: 1,
          reason: '确认排行样例',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  return submission.releaseId;
}
async function publish(
  http: AuthHttp,
  reviewer: AuthHttp,
  platform: 'maibot' | 'astrbot' = 'maibot',
) {
  const persona = await completePersona(http, platform);
  return { ...persona, releaseId: await release(http, reviewer, persona, '1.0.0') };
}
async function download(
  http: AuthHttp,
  persona: { id: string; releaseId: string },
  format = 'text',
) {
  const response = await http.raw(
    '/api/v1/personas/' +
      persona.id +
      '/releases/' +
      persona.releaseId +
      '/export?format=' +
      format,
  );
  expect(response.status).toBe(200);
  await response.arrayBuffer();
}
async function ranking(query = 'kind=downloads&window=all') {
  const response = await stack.browser().raw('/api/v1/rankings?' + query);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return RankingListResponseSchema.parse(await response.json());
}
async function generationState(id: string) {
  const result = await stack.owner.pool.query<{ status: string; error_code: string | null }>(
    'SELECT status,error_code FROM ranking_generations WHERE id=$1',
    [id],
  );
  return result.rows[0];
}
async function rebuild() {
  const id = await enqueueRankingRefresh(stack.owner, 'manual');
  if (!id) throw new Error('缺少新重建请求');
  await stack.tick();
  await expect
    .poll(
      async () => {
        // 与实际Worker一样持续调度，首批10条可能被真实邮件和通知占满
        await stack.tick();
        return (await generationState(id))?.status;
      },
      { timeout: 5000, interval: 100 },
    )
    .toBe('completed');
  return id;
}
async function eventFor(id: string) {
  const result = await stack.owner.pool.query<{ id: string }>(
    "SELECT id FROM outbox_events WHERE topic='rankings.refresh' AND payload->>'generationId'=$1",
    [id],
  );
  const event = result.rows[0];
  if (!event) throw new Error('缺少真实Outbox事件');
  return event.id;
}

it('空站通过真实Outbox与Worker发布36个原子空榜单，公开读取有错误和严格组合边界', async () => {
  expect((await stack.browser().raw('/api/v1/rankings')).status).toBe(503);
  const scheduled = await Promise.all([
    enqueueRankingRefresh(stack.owner),
    enqueueRankingRefresh(stack.owner),
  ]);
  const ids = scheduled.filter((id): id is string => id !== null);
  expect(ids.length).toBeGreaterThanOrEqual(1);
  const duplicates = await stack.owner.pool.query<{ total: number }>(
    'SELECT count(*)::integer AS total FROM (SELECT request_key FROM ranking_generations GROUP BY request_key HAVING count(*)>1) duplicates',
  );
  expect(duplicates.rows[0]?.total).toBe(0);
  await stack.tick();
  for (const id of ids)
    await expect
      .poll(async () => (await generationState(id))?.status, { timeout: 5000, interval: 100 })
      .toBe('completed');
  const result = await ranking('kind=hot&window=7d');
  expect(result.data).toEqual([]);
  expect(result.meta).toMatchObject({ total: 0, algorithm: 'interactions-v1', limited: false });
  expect(
    (
      await stack.owner.pool.query('SELECT * FROM ranking_boards WHERE generation_id=$1', [
        result.meta.snapshotId,
      ])
    ).rowCount,
  ).toBe(36);
  expect(
    (await stack.owner.pool.query("SELECT * FROM processed_events WHERE consumer='rankings'"))
      .rowCount,
  ).toBe(ids.length);
  for (const query of [
    'kind=hot&window=all',
    'kind=likes&window=invalid',
    'kind=new&window=7d',
    'kind=downloads&window=all&page=51',
    'role=admin',
  ]) {
    const invalid = await stack.browser().raw('/api/v1/rankings?' + query);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  }
  expect((await stack.browser().raw('/api/v1/rankings?snapshotId=' + randomUUID())).status).toBe(
    404,
  );
});

it('导出跨格式与版本去重、排除本人，真实下载和热门榜支持分平台并只返回卡片白名单', async () => {
  const author = await verifiedCreator(stack);
  const reader = await verifiedCreator(stack);
  const admin = await stack.admin();
  const mai = await publish(author.http, admin.http);
  const astr = await publish(author.http, admin.http, 'astrbot');
  await download(author.http, mai);
  await download(reader.http, mai);
  await download(reader.http, mai, 'markdown');
  const nextRelease = await release(author.http, admin.http, mai, '1.0.1');
  await download(reader.http, { ...mai, releaseId: nextRelease });
  await download(stack.browser(), { ...mai, releaseId: nextRelease });
  await download(reader.http, astr);
  await rebuild();
  const result = await ranking();
  expect(result.data.map((row) => row.personaId)).toEqual([mai.id, astr.id]);
  expect(result.data.map((row) => row.eligibleExports)).toEqual([2, 1]);
  expect(result.data[0]?.releaseId).toBe(nextRelease);
  expect(result.data.map((row) => row.position)).toEqual([1, 2]);
  for (const item of result.data) {
    expect(item.snapshot).not.toHaveProperty('content');
    expect(item.snapshot).not.toHaveProperty('readmeMarkdown');
    expect(item.snapshot.origin).not.toHaveProperty('sourceDescription');
    expect(item).not.toHaveProperty('ownerId');
  }
  expect(
    (await ranking('kind=downloads&window=all&platform=astrbot')).data.map((row) => row.personaId),
  ).toEqual([astr.id]);
  const hot = await ranking('kind=hot&window=7d');
  expect(hot.data.map((row) => row.personaId)).toEqual([mai.id, astr.id]);
  expect(hot.data[0]?.score).toBeCloseTo(2, 2);
  expect(hot.data[1]?.score).toBeCloseTo(1, 2);
});

it('UTC日期窗口、滚动热度与首次公开的新作边界可验证，清理匿名摘要不减少总榜', async () => {
  const author = await verifiedCreator(stack);
  const reader = await verifiedCreator(stack);
  const admin = await stack.admin();
  const maiTemplate = await publish(author.http, admin.http);
  const astrTemplate = await publish(author.http, admin.http, 'astrbot');
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * 86_400_000);
  const client = await stack.owner.pool.connect();
  const [older, recent, archive, future] = await (async () => {
    try {
      return [
        await seedRankingHistory(client, maiTemplate.id, ago(60), ago(1)),
        await seedRankingHistory(client, astrTemplate.id, ago(10), ago(2)),
        await seedRankingHistory(client, maiTemplate.id, ago(60), ago(3)),
        await seedRankingHistory(client, astrTemplate.id, ago(10), ago(4)),
      ] as const;
    } finally {
      client.release();
    }
  })();
  for (const template of [maiTemplate, astrTemplate])
    expect(
      (
        await author.http.write('/api/v1/me/personas/' + template.id + '/visibility', {
          visibility: 'hidden',
          reason: '历史样本基准不参与时间窗口排名',
        })
      ).status,
    ).toBe(200);
  for (const [persona, offset] of [
    [older, -8],
    [recent, 0],
    [archive, -40],
    [future, 1],
  ] as const) {
    await download(reader.http, {
      ...persona,
      releaseId: offset < 0 ? persona.firstReleaseId : persona.releaseId,
    });
    for (const table of [
      'export_daily_metrics',
      'export_version_daily_metrics',
      'export_version_subject_days',
    ] as const)
      await stack.owner.pool.query(
        `UPDATE ${table} SET day=(clock_timestamp() AT TIME ZONE 'UTC')::date+$1::integer WHERE persona_id=$2`,
        [offset, persona.id],
      );
    await stack.owner.pool.query(
      "UPDATE export_subject_days SET day=(clock_timestamp() AT TIME ZONE 'UTC')::date+$1::integer,created_at=clock_timestamp()+$1::integer*interval '1 day' WHERE persona_id=$2",
      [offset, persona.id],
    );
  }
  await pruneExportSubjects(stack.owner);
  await rebuild();
  expect((await ranking('kind=downloads&window=7d')).data.map((row) => row.personaId)).toEqual([
    recent.id,
  ]);
  expect(
    new Set((await ranking('kind=downloads&window=30d')).data.map((row) => row.personaId)),
  ).toEqual(new Set([older.id, recent.id]));
  expect(new Set((await ranking()).data.map((row) => row.personaId))).toEqual(
    new Set([older.id, recent.id, archive.id]),
  );
  expect((await ranking('kind=hot&window=7d')).data.map((row) => row.personaId)).toEqual([
    recent.id,
  ]);
  expect(
    (await ranking('kind=new&window=30d')).data.some((row) => row.personaId === older.id),
  ).toBe(false);
  expect(
    (await ranking('kind=new&window=30d')).data.some((row) => row.personaId === archive.id),
  ).toBe(false);
  expect((await ranking('kind=updated&window=all')).data.map((row) => row.personaId)).toEqual([
    older.id,
    recent.id,
    archive.id,
    future.id,
  ]);
  expect(
    (
      await stack.owner.pool.query('SELECT * FROM export_subject_days WHERE persona_id=$1', [
        archive.id,
      ])
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await stack.owner.pool.query(
        'SELECT ranking_count FROM export_daily_metrics WHERE persona_id=$1',
        [archive.id],
      )
    ).rows[0]?.ranking_count,
  ).toBe(1);
});

it('已发布快照的旧ID与分页仍实时过滤隐藏和当前版本变更，不泄漏失去资格的作品', async () => {
  const author = await verifiedCreator(stack);
  const reader = await verifiedCreator(stack);
  const admin = await stack.admin();
  const mai = await publish(author.http, admin.http);
  const astr = await publish(author.http, admin.http, 'astrbot');
  await download(reader.http, mai);
  await download(reader.http, astr);
  const firstId = await rebuild();
  const first = await ranking('kind=downloads&window=all&pageSize=1&snapshotId=' + firstId);
  const second = await ranking('kind=downloads&window=all&pageSize=1&page=2&snapshotId=' + firstId);
  expect(new Set([...first.data, ...second.data].map((row) => row.personaId))).toEqual(
    new Set([mai.id, astr.id]),
  );
  expect(
    (
      await author.http.write('/api/v1/me/personas/' + mai.id + '/visibility', {
        visibility: 'hidden',
        reason: '测试即时隐藏',
      })
    ).status,
  ).toBe(200);
  const hidden = await ranking('kind=downloads&window=all&snapshotId=' + firstId);
  expect(hidden.data.map((row) => row.personaId)).toEqual([astr.id]);
  expect(hidden.data[0]?.position).toBe(1);
  expect(
    (
      await stack
        .browser()
        .raw('/api/v1/personas/' + mai.id + '/releases/' + mai.releaseId + '/export?format=text')
    ).status,
  ).toBe(404);
  const nextRelease = await release(author.http, admin.http, astr, '1.0.1');
  expect((await ranking('kind=downloads&window=all&snapshotId=' + firstId)).data).toEqual([]);
  const nextId = await rebuild();
  expect(nextId).not.toBe(firstId);
  const latest = await ranking();
  expect(latest.data.map((row) => row.releaseId)).toEqual([nextRelease]);
  for (const state of ['blocked', 'normal'] as const) {
    expect(
      (
        await moderatePersona(admin.http, astr.id, {
          state,
          reason: '核验榜单实时公开资格',
        })
      ).status,
    ).toBe(200);
    const visible = await ranking('kind=downloads&window=all&snapshotId=' + nextId);
    expect(visible.data.map((row) => row.personaId)).toEqual(state === 'blocked' ? [] : [astr.id]);
    expect(visible.meta.total).toBe(state === 'blocked' ? 0 : 1);
  }
});

it('计算锁不可得时不伪造任务终态，解锁后原事件可以完成计算', async () => {
  const author = await verifiedCreator(stack);
  const admin = await stack.admin();
  const persona = await publish(author.http, admin.http);
  await download(stack.browser(), persona);
  const firstId = await rebuild();
  const nextId = await enqueueRankingRefresh(stack.owner, 'manual');
  if (!nextId) throw new Error('缺少新请求');
  const eventId = await eventFor(nextId);
  const keeper = await stack.owner.pool.connect();
  try {
    await keeper.query('SELECT pg_advisory_lock(1347244619,1)');
    await expect(buildRankingGeneration(stack.owner, nextId, eventId)).rejects.toThrow(
      'RANKING_REFRESH_BUSY',
    );
    expect((await generationState(nextId))?.status).toBe('pending');
    await expect(
      buildRankingGeneration(stack.owner, nextId, eventId, { number: 5, last: true }),
    ).rejects.toThrow('RANKING_REFRESH_BUSY');
    expect(await generationState(nextId)).toMatchObject({
      status: 'pending',
      error_code: null,
    });
    expect(
      (
        await stack.owner.pool.query(
          'SELECT state,execution_attempts,terminal_proof FROM ranking_generation_runs WHERE event_id=$1',
          [eventId],
        )
      ).rows,
    ).toEqual([{ state: 'pending', execution_attempts: null, terminal_proof: null }]);
    expect((await ranking()).meta.snapshotId).toBe(firstId);
  } finally {
    await keeper.query('SELECT pg_advisory_unlock(1347244619,1)');
    keeper.release();
  }
  expect(await buildRankingGeneration(stack.owner, nextId, eventId)).toBe(true);
  expect((await ranking()).meta.snapshotId).toBe(nextId);
  expect(await buildRankingGeneration(stack.owner, nextId, eventId)).toBe(false);
});

it('插入失败时真实队列重试保留上一批，成功和重复投递不追加半份榜单', async () => {
  const author = await verifiedCreator(stack);
  const admin = await stack.admin();
  const persona = await publish(author.http, admin.http);
  await download(stack.browser(), persona);
  const firstId = await rebuild();
  const nextId = await enqueueRankingRefresh(stack.owner, 'manual');
  if (!nextId) throw new Error('缺少新请求');
  const eventId = await eventFor(nextId);
  await stack.owner.pool.query(
    "CREATE FUNCTION reject_ranking_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic ranking insert failure' USING ERRCODE='23514'; END $$",
  );
  await stack.owner.pool.query(
    'CREATE TRIGGER reject_ranking_fixture BEFORE INSERT ON ranking_entries FOR EACH ROW EXECUTE FUNCTION reject_ranking_fixture()',
  );
  let stopListening: () => void = () => undefined;
  const firstFailure = new Promise<void>((resolve) => {
    const failed = (job: { id?: string | undefined } | undefined) => {
      if (job?.id === eventId) resolve();
    };
    stack.worker.on('failed', failed);
    stopListening = () => stack.worker.off('failed', failed);
  });
  try {
    await stack.tick();
    await firstFailure;
    await expect
      .poll(async () => generationState(nextId), { timeout: 5000, interval: 100 })
      .toMatchObject({ status: 'pending', error_code: null });
    expect(
      (
        await stack.owner.pool.query(
          'SELECT state,last_error_code,terminal_proof FROM ranking_generation_runs WHERE event_id=$1',
          [eventId],
        )
      ).rows,
    ).toEqual([
      { state: 'retrying', last_error_code: 'RANKING_BUILD_FAILED', terminal_proof: null },
    ]);
    expect((await ranking()).meta.snapshotId).toBe(firstId);
    expect(
      (
        await stack.owner.pool.query('SELECT * FROM ranking_boards WHERE generation_id=$1', [
          nextId,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await stack.owner.pool.query(
          "SELECT * FROM processed_events WHERE consumer='rankings' AND event_id=$1",
          [eventId],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    stopListening();
    await stack.owner.pool.query('DROP TRIGGER reject_ranking_fixture ON ranking_entries');
    await stack.owner.pool.query('DROP FUNCTION reject_ranking_fixture()');
  }
  await expect
    .poll(async () => (await generationState(nextId))?.status, { timeout: 5000, interval: 100 })
    .toBe('completed');
  expect((await ranking()).meta.snapshotId).toBe(nextId);
  expect(
    await Promise.all([
      buildRankingGeneration(stack.owner, nextId, eventId),
      buildRankingGeneration(stack.owner, nextId, eventId),
    ]),
  ).toEqual([false, false]);
  expect(
    (await stack.owner.pool.query('SELECT * FROM ranking_boards WHERE generation_id=$1', [nextId]))
      .rowCount,
  ).toBe(36);
});

it('最后一次计算失败记录可核对的终态，回滚全部新榜单并保留上一批', async () => {
  const author = await verifiedCreator(stack);
  const admin = await stack.admin();
  const persona = await publish(author.http, admin.http);
  await download(stack.browser(), persona);
  const firstId = await rebuild();
  const nextId = await enqueueRankingRefresh(stack.owner, 'manual');
  if (!nextId) throw new Error('缺少新请求');
  const eventId = await eventFor(nextId);
  await stack.owner.pool.query(
    "CREATE FUNCTION reject_final_ranking_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic final ranking failure' USING ERRCODE='23514'; END $$",
  );
  await stack.owner.pool.query(
    'CREATE TRIGGER reject_final_ranking_fixture BEFORE INSERT ON ranking_entries FOR EACH ROW EXECUTE FUNCTION reject_final_ranking_fixture()',
  );
  try {
    await expect(
      buildRankingGeneration(stack.owner, nextId, eventId, { number: 5, last: true }),
    ).rejects.toThrow();
    expect(await generationState(nextId)).toMatchObject({
      status: 'failed',
      error_code: 'RANKING_BUILD_FAILED',
    });
    expect(
      (
        await stack.owner.pool.query(
          'SELECT state,execution_attempts,terminal_proof FROM ranking_generation_runs WHERE event_id=$1',
          [eventId],
        )
      ).rows,
    ).toEqual([{ state: 'failed', execution_attempts: 5, terminal_proof: 'worker_final_failure' }]);
    expect(
      (
        await stack.owner.pool.query('SELECT * FROM ranking_boards WHERE generation_id=$1', [
          nextId,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await stack.owner.pool.query(
          "SELECT * FROM processed_events WHERE consumer='rankings' AND event_id=$1",
          [eventId],
        )
      ).rowCount,
    ).toBe(0);
    expect((await ranking()).meta.snapshotId).toBe(firstId);
  } finally {
    await stack.owner.pool.query('DROP TRIGGER reject_final_ranking_fixture ON ranking_entries');
    await stack.owner.pool.query('DROP FUNCTION reject_final_ranking_fixture()');
  }
});

it('快照保留和过期查询有明确边界，旧事件重放幂等且数据库拒绝非法分数', async () => {
  const author = await verifiedCreator(stack);
  const admin = await stack.admin();
  const persona = await publish(author.http, admin.http);
  await download(stack.browser(), persona);
  const ids: string[] = [];
  for (let index = 0; index < 13; index++) ids.push(await rebuild());
  const firstId = ids[0];
  const lastId = ids.at(-1);
  if (!firstId || !lastId) throw new Error('缺少快照');
  const firstEvent = await eventFor(firstId);
  await pruneRankings(stack.owner);
  expect(
    (await stack.owner.pool.query("SELECT * FROM ranking_generations WHERE status='completed'"))
      .rowCount,
  ).toBe(12);
  expect((await stack.browser().raw('/api/v1/rankings?snapshotId=' + firstId)).status).toBe(404);
  expect(await buildRankingGeneration(stack.owner, firstId, firstEvent)).toBe(false);
  for (const score of ['NaN', 'Infinity', '-1'])
    await expect(
      stack.owner.pool.query(
        'UPDATE ranking_entries SET score=$1::double precision WHERE generation_id=$2',
        [score, lastId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  await stack.owner.pool.query(
    "UPDATE ranking_generations SET generated_at=clock_timestamp()-interval '6 minutes' WHERE id=$1",
    [lastId],
  );
  expect((await ranking('kind=downloads&window=all&snapshotId=' + lastId)).meta.stale).toBe(true);
});

it('真实表锁超时返回可重试错误，释放锁后读取恢复且不改连接池超时', async () => {
  await rebuild();
  const keeper = await stack.owner.pool.connect();
  await keeper.query('BEGIN');
  try {
    await keeper.query('LOCK TABLE ranking_entries IN ACCESS EXCLUSIVE MODE');
    const response = await stack.browser().raw('/api/v1/rankings');
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    const body: unknown = await response.json();
    expect(body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(JSON.stringify(body)).not.toContain('statement_timeout');
  } finally {
    await keeper.query('ROLLBACK');
    keeper.release();
  }
  expect((await ranking()).data).toEqual([]);
});

it('公开读取按真实连接地址限流，未受信任的转发头不能更换主体绕过限制', async () => {
  await rebuild();
  const browser = stack.browser();
  for (let index = 1; index <= 60; index++) {
    const response = await browser.raw('/api/v1/rankings', {
      headers: { 'X-Forwarded-For': '203.0.113.' + index },
    });
    expect(response.status).toBe(200);
    await response.json();
  }
  const limited = await browser.raw('/api/v1/rankings', {
    headers: { 'X-Forwarded-For': '198.51.100.1' },
  });
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  expect(await limited.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
});
