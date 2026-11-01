import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  RetryAdminRankingGenerationSchema,
  OperationalTaskCommandSchema,
} from '@personamarket/contracts';
import {
  observeRankingQueueEvent,
  rankingEventMatches,
  rankingRetryEligibility,
} from '@personamarket/server';

const id = randomUUID(),
  eventId = randomUUID();
it('处理原因的最小字符数与数据库一致，三个补充平面字符不能穿过HTTP校验后变成数据库错误', () => {
  const body = { expectedVersion: 'a'.repeat(64), confirmed: true, reason: '😀😀😀' };
  expect(RetryAdminRankingGenerationSchema.safeParse(body).success).toBe(false);
  expect(OperationalTaskCommandSchema.safeParse({ ...body, action: 'retry' }).success).toBe(false);
  expect(
    RetryAdminRankingGenerationSchema.safeParse({ ...body, reason: '😀😀😀😀😀' }).success,
  ).toBe(true);
});
const facts = () => ({
  completed: false,
  definitionVerified: true,
  eventVerified: true,
  leaseActive: false,
  boards: 0,
  currentEventProcessed: false,
  terminalVerified: true,
  automaticPending: false,
  legacyUnverifiable: false,
  manualRound: 0,
  nextAllowedAt: null as string | null,
});

it('排行恢复只接受规范化理由、原版本与明确确认；未知字段不进入指纹', () => {
  const body = {
    expectedVersion: 'a'.repeat(64),
    reason: '  核对真实原批次失败后恢复  ',
    confirmed: true,
  };
  expect(RetryAdminRankingGenerationSchema.parse(body).reason).toBe('核对真实原批次失败后恢复');
  expect(
    RetryAdminRankingGenerationSchema.safeParse({ ...body, algorithm: 'interactions-v2' }).success,
  ).toBe(false);
  expect(RetryAdminRankingGenerationSchema.safeParse({ ...body, confirmed: false }).success).toBe(
    false,
  );
});

it('精确事件校验拒绝其他topic、归属和额外payload，不能按最新事件猜当前轮', () => {
  expect(
    rankingEventMatches(id, eventId, {
      id: eventId,
      topic: 'rankings.refresh',
      payload: { generationId: id },
    }),
  ).toBe(true);
  for (const event of [
    { id: eventId, topic: 'system.probe', payload: { generationId: id } },
    { id: eventId, topic: 'rankings.refresh', payload: { generationId: randomUUID() } },
    { id: eventId, topic: 'rankings.refresh', payload: { generationId: id, schemaVersion: 1 } },
  ])
    expect(rankingEventMatches(id, eventId, event)).toBe(false);
});

it('仅业务failed或旧attempts5不能证明自动终结；活动租约与部分榜板拒绝恢复', () => {
  expect(
    rankingRetryEligibility({ ...facts(), terminalVerified: false, legacyUnverifiable: true })
      .blockedReason,
  ).toBe('LEGACY_TERMINAL_UNVERIFIABLE');
  expect(rankingRetryEligibility({ ...facts(), leaseActive: true }).blockedReason).toBe(
    'DISPATCH_LEASE_ACTIVE',
  );
  expect(rankingRetryEligibility({ ...facts(), boards: 1 }).blockedReason).toBe(
    'RESULT_INCONSISTENT',
  );
  expect(rankingRetryEligibility(facts()).allowed).toBe(true);
});

it('同generation人工三轮与冷却按持久事实限制，已完成和自动处理中分别说明', () => {
  expect(rankingRetryEligibility({ ...facts(), manualRound: 3 }).blockedReason).toBe(
    'MANUAL_LIMIT_REACHED',
  );
  expect(
    rankingRetryEligibility(
      { ...facts(), nextAllowedAt: '2099-01-01T00:00:00.000Z' },
      new Date('2026-11-01'),
    ).blockedReason,
  ).toBe('COOLDOWN_ACTIVE');
  expect(rankingRetryEligibility({ ...facts(), completed: true }).blockedReason).toBe('COMPLETED');
  expect(
    rankingRetryEligibility({ ...facts(), terminalVerified: false, automaticPending: true })
      .blockedReason,
  ).toBe('AUTO_RETRY_PENDING');
});

it('精确队列观察区分missing/不可用/未耗尽/已完成，只有匹配预算与实际终结时间才是最终失败', async () => {
  const job = {
    id: eventId,
    name: 'rankings.refresh',
    data: { eventId, generationId: id },
    attemptsMade: 5,
    opts: { attempts: 5 },
    finishedOn: Date.now() - 1,
    getState: async () => 'failed',
  };
  expect((await observeRankingQueueEvent({ getJob: async () => job }, id, eventId)).state).toBe(
    'matched_final',
  );
  expect(
    (
      await observeRankingQueueEvent(
        { getJob: async () => ({ ...job, attemptsMade: 4 }) },
        id,
        eventId,
      )
    ).state,
  ).toBe('unverifiable');
  expect(
    (
      await observeRankingQueueEvent(
        { getJob: async () => ({ ...job, getState: async () => 'completed' }) },
        id,
        eventId,
      )
    ).state,
  ).toBe('unverifiable');
  expect(
    (await observeRankingQueueEvent({ getJob: async () => undefined }, id, eventId)).state,
  ).toBe('missing');
  // 纯单元输入；不连接/停止真实Redis，不执行基础设施故障注入。
  expect(
    (
      await observeRankingQueueEvent(
        {
          getJob: async () => {
            throw Error('unit-observer-unavailable');
          },
        },
        id,
        eventId,
      )
    ).state,
  ).toBe('unavailable');
});
