import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminUserResponseSchema,
  PublicPersonaListResponseSchema,
  RankingListResponseSchema,
} from '@personamarket/contracts';
import { buildRankingGeneration, enqueueRankingRefresh } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import {
  interactionRankingScenario,
  rankingSnapshotAt,
} from '../fixtures/interaction-ranking-scenario.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
async function eventFor(id: string) {
  const row = (
    await stack.owner.pool.query<{ id: string }>(
      "SELECT id FROM outbox_events WHERE topic='rankings.refresh' AND payload->>'generationId'=$1",
      [id],
    )
  ).rows[0];
  if (!row) throw Error('缺少实际重建事件');
  return row.id;
}
async function ranking(id: string, kind: string, window = '7d') {
  const response = await stack
    .browser()
    .raw(`/api/v1/rankings?snapshotId=${id}&kind=${kind}&window=${window}`);
  expect(response.status).toBe(200);
  return RankingListResponseSchema.parse(await response.json());
}

it('计算事务中并发取消互动不产生半新半旧的榜板，下一批反映取消且旧快照保留评分事实', async () => {
  const fixture = await interactionRankingScenario(stack),
    actor = fixture.actor(0),
    http = stack.browser();
  expect(
    (
      await http.write('/api/v1/auth/login', {
        identifier: actor.username,
        password: fixture.reader.password,
      })
    ).status,
  ).toBe(200);
  const id = await enqueueRankingRefresh(stack.owner, 'manual');
  if (!id) throw Error('缺少实际并发批次');
  const event = await eventFor(id);
  // 在第一块板插入时暂停真实生产计算，事务快照已建立；不依靠定时sleep猜测竞态
  await stack.owner.pool.query(
    'CREATE FUNCTION pause_interaction_ranking_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(1347244619,91); RETURN NEW; END $$',
  );
  await stack.owner.pool.query(
    'CREATE TRIGGER pause_interaction_ranking_fixture BEFORE INSERT ON ranking_boards FOR EACH ROW EXECUTE FUNCTION pause_interaction_ranking_fixture()',
  );
  const keeper = await stack.owner.pool.connect();
  let pending: Promise<{ value: boolean } | { error: unknown }> | undefined;
  let outcome: { value: boolean } | { error: unknown } | undefined;
  try {
    await keeper.query('SELECT pg_advisory_lock(1347244619,91)');
    pending = buildRankingGeneration(stack.owner, id, event).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await expect
      .poll(
        async () =>
          (
            await stack.owner.pool.query<{ waiting: boolean }>(
              "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=1347244619 AND objid=91 AND objsubid=2 AND NOT granted) AS waiting",
            )
          ).rows[0]?.waiting,
        { timeout: 5000, interval: 50 },
      )
      .toBe(true);
    expect(
      (await stack.owner.pool.query('SELECT 1 FROM ranking_boards WHERE generation_id=$1', [id]))
        .rowCount,
    ).toBe(0);
    for (const kind of ['like', 'favorite'])
      expect(
        (await http.write('/api/v1/personas/' + fixture.mai.id + '/' + kind, undefined, 'DELETE'))
          .status,
      ).toBe(200);
  } finally {
    await keeper.query('SELECT pg_advisory_unlock(1347244619,91)');
    keeper.release();
    try {
      if (pending) {
        outcome = await pending;
      }
    } finally {
      await stack.owner.pool.query(
        'DROP TRIGGER pause_interaction_ranking_fixture ON ranking_boards',
      );
      await stack.owner.pool.query('DROP FUNCTION pause_interaction_ranking_fixture()');
    }
  }
  if (!outcome) throw Error('缺少并发计算结果');
  if ('error' in outcome) throw outcome.error;
  expect(outcome.value).toBe(true);
  const before = await ranking(id, 'hot');
  expect(before.data.find((row) => row.personaId === fixture.mai.id)).toMatchObject({
    eligibleLikes: 1,
    eligibleFavorites: 1,
    eligibleExports: 1,
  });
  for (const kind of ['likes', 'favorites'])
    expect(
      (await ranking(id, kind)).data.find((row) => row.personaId === fixture.mai.id)?.score,
    ).toBe(1);
  const next = await enqueueRankingRefresh(stack.owner, 'manual');
  if (!next) throw Error('缺少取消后重建请求');
  expect(await buildRankingGeneration(stack.owner, next, await eventFor(next))).toBe(true);
  expect(
    (await ranking(next, 'hot')).data.find((row) => row.personaId === fixture.mai.id),
  ).toMatchObject({ eligibleLikes: 0, eligibleFavorites: 0, eligibleExports: 1 });
  for (const kind of ['likes', 'favorites'])
    expect((await ranking(next, kind)).data.map((row) => row.personaId)).not.toContain(
      fixture.mai.id,
    );
  expect((await ranking(id, 'hot')).data).toEqual(before.data);
});

it('被封禁账号的既有关系退出新排行和探索计分，展示计数与有效关系资格保持一致', async () => {
  const fixture = await interactionRankingScenario(stack),
    actor = fixture.actor(0);
  const response = await fixture.admin.http.raw('/api/v1/admin/users/' + actor.id);
  expect(response.status).toBe(200);
  const detail = AdminUserResponseSchema.parse(await response.json()).data;
  expect(
    (
      await fixture.admin.http.write(
        '/api/v1/admin/users/' + actor.id + '/status',
        {
          status: 'banned',
          scope: 'account_only',
          expectedSecurityVersion: detail.securityVersion,
          reason: '核对无效互动账号退出排行',
        },
        'PUT',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const at = (await stack.owner.pool.query<{ at: Date }>('SELECT clock_timestamp() AS at')).rows[0]
    ?.at;
  if (!at) throw Error('缺少封禁后计算时刻');
  const id = await rankingSnapshotAt(stack, at);
  for (const kind of ['likes', 'favorites']) {
    expect((await ranking(id, kind)).data.map((row) => row.personaId)).not.toContain(
      fixture.mai.id,
    );
    expect(
      (await ranking(id, kind, 'all')).data.find((row) => row.personaId === fixture.mai.id)?.score,
    ).toBe(2);
  }
  const discovered = await stack.browser().raw('/api/v1/personas?sort=hot');
  expect(discovered.status).toBe(200);
  const mai = PublicPersonaListResponseSchema.parse(await discovered.json()).data.find(
    (row) => row.personaId === fixture.mai.id,
  );
  expect(mai?.heatMetric).toMatchObject({
    eligibleLikes: 0,
    eligibleFavorites: 0,
    eligibleExports: 1,
  });
});

it('第二组写入失败时回滚已写入的基础榜板，保留上一成功快照且原事件可重试一次完成', async () => {
  const fixture = await interactionRankingScenario(stack);
  const previous = await rankingSnapshotAt(stack, fixture.at);
  const id = await enqueueRankingRefresh(stack.owner, 'manual');
  if (!id) throw Error('缺少分组失败批次');
  const event = await eventFor(id);
  await stack.owner.pool
    .query(`CREATE FUNCTION reject_social_ranking_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.kind IN ('likes','favorites') THEN
        IF EXISTS(SELECT 1 FROM ranking_entries WHERE generation_id=NEW.generation_id AND kind='hot') THEN
          RAISE EXCEPTION 'INTERACTION_STAGE_FAILED_AFTER_BASE_WRITES' USING ERRCODE='23514';
        END IF;
        RAISE EXCEPTION 'BASE_STAGE_MISSING' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$`);
  await stack.owner.pool.query(
    'CREATE TRIGGER reject_social_ranking_fixture BEFORE INSERT ON ranking_entries FOR EACH ROW EXECUTE FUNCTION reject_social_ranking_fixture()',
  );
  try {
    let failure: unknown;
    try {
      await buildRankingGeneration(stack.owner, id, event);
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(Error);
    for (let depth = 0; depth < 6 && failure instanceof Error && failure.cause; depth++)
      failure = failure.cause;
    expect(failure).toMatchObject({
      code: '23514',
      message: 'INTERACTION_STAGE_FAILED_AFTER_BASE_WRITES',
    });
    for (const table of ['ranking_entries', 'ranking_boards'])
      expect(
        (await stack.owner.pool.query('SELECT 1 FROM ' + table + ' WHERE generation_id=$1', [id]))
          .rowCount,
      ).toBe(0);
    expect(
      (
        await stack.owner.pool.query(
          'SELECT 1 FROM processed_events WHERE consumer=$1 AND event_id=$2',
          ['rankings', event],
        )
      ).rowCount,
    ).toBe(0);
    const response = await stack.browser().raw('/api/v1/rankings');
    expect(response.status).toBe(200);
    expect(RankingListResponseSchema.parse(await response.json()).meta.snapshotId).toBe(previous);
  } finally {
    await stack.owner.pool.query('DROP TRIGGER reject_social_ranking_fixture ON ranking_entries');
    await stack.owner.pool.query('DROP FUNCTION reject_social_ranking_fixture()');
  }
  expect(await buildRankingGeneration(stack.owner, id, event, { number: 2, last: false })).toBe(
    true,
  );
  expect(
    (await stack.owner.pool.query('SELECT 1 FROM ranking_boards WHERE generation_id=$1', [id]))
      .rowCount,
  ).toBe(36);
  expect(await buildRankingGeneration(stack.owner, id, event)).toBe(false);
  // 这里验证两类板均重建，使用总榜避免夹具恰在7日下界的收藏随实际时钟退出窗口
  expect((await ranking(id, 'likes', 'all')).data).toHaveLength(2);
  expect((await ranking(id, 'favorites', 'all')).data).toHaveLength(2);
});
