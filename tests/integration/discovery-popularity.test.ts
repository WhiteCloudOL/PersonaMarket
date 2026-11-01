import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import {
  PersonaDraftSchema,
  PublicPersonaListResponseSchema,
  SubmissionResponseSchema,
  RankingListResponseSchema,
} from '@personamarket/contracts';
import { enqueueRankingRefresh } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import { seedRankingHistory } from '../fixtures/ranking-history.js';
import type { AuthHttp } from '../fixtures/auth-http.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const categoryId = '10000000-0000-4000-8000-000000000001';
const tagId = '20000000-0000-4000-8000-000000000001';

async function release(
  http: AuthHttp,
  reviewer: AuthHttp,
  persona: { id: string; revision: number },
  version = '1.0.0',
) {
  const response = await http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version,
      expectedDraftRevision: persona.revision,
      changelog: '有效导出排序验收',
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
          reason: '核实真实排序样本',
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
  const created = await completePersona(http, platform);
  const draft = PersonaDraftSchema.parse({
    ...created.draft,
    categoryId,
    tagIds: [tagId],
    title: '星海有效导出样本',
    readmeMarkdown: '公开 README 搜索标记',
    recommendedModels: [{ modelId: 'Qwen/星海-Model', note: '作者填写' }],
    ...(platform === 'astrbot'
      ? {
          platform: 'astrbot',
          content: {
            systemPrompt: '温柔回应',
            dialoguePairs: [{ id: randomUUID(), user: '你好', assistant: '欢迎' }],
          },
        }
      : {}),
  });
  expect(
    (
      await http.write('/api/v1/me/personas/' + created.id + '/draft', draft, 'PUT', {
        'If-Match': '"draft-2"',
      })
    ).status,
  ).toBe(200);
  const persona = { id: created.id, revision: 3 };
  return { ...persona, releaseId: await release(http, reviewer, persona) };
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
async function list(query: Record<string, string> = { sort: 'downloads' }) {
  const response = await stack.browser().raw('/api/v1/personas?' + new URLSearchParams(query));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return PublicPersonaListResponseSchema.parse(await response.json());
}

it('10次与2次真实有效导出按数值排列，多格式多版本去重且排除作者，组合筛选不丢低排名作品', async () => {
  const author = await verifiedCreator(stack);
  const admin = await stack.admin();
  const mai = await publish(author.http, admin.http);
  const astr = await publish(author.http, admin.http, 'astrbot');
  const zero = await publish(author.http, admin.http);
  const repeated = stack.browser();
  await download(author.http, mai);
  await download(repeated, mai);
  await download(repeated, mai, 'markdown');
  const nextRelease = await release(author.http, admin.http, mai, '1.0.1');
  await download(repeated, { ...mai, releaseId: nextRelease });
  for (let index = 0; index < 9; index++) await download(stack.browser(), mai);
  for (let index = 0; index < 2; index++) await download(stack.browser(), astr);
  const result = await list();
  expect(result.data.map((row) => row.personaId)).toEqual([mai.id, astr.id, zero.id]);
  expect(result.data.map((row) => row.exportMetric)).toEqual(
    [10, 2, 0].map((eligibleExports) => ({ eligibleExports, window: 'all' })),
  );
  expect(result.data[0]?.releaseId).toBe(nextRelease);
  const hot = await list({ sort: 'hot' });
  expect(hot.data.map((row) => row.personaId)).toEqual([mai.id, astr.id, zero.id]);
  expect(hot.data.map((row) => row.heatMetric?.eligibleExports)).toEqual([10, 2, 0]);
  expect(hot.data[0]?.heatMetric?.score).toBeCloseTo(10, 2);
  expect(hot.data[2]?.heatMetric).toEqual({
    score: 0,
    eligibleExports: 0,
    algorithm: 'interactions-v1',
    eligibleLikes: 0,
    eligibleFavorites: 0,
  });
  const generationId = await enqueueRankingRefresh(stack.owner, 'manual');
  await stack.tick();
  await expect
    .poll(
      async () => {
        await stack.tick();
        return (
          await stack.owner.pool.query('SELECT status FROM ranking_generations WHERE id=$1', [
            generationId,
          ])
        ).rows[0]?.status;
      },
      { timeout: 5000, interval: 100 },
    )
    .toBe('completed');
  const rankingResponse = await stack.browser().raw('/api/v1/rankings?kind=hot&window=7d');
  expect(rankingResponse.status).toBe(200);
  const ranked = RankingListResponseSchema.parse(await rankingResponse.json());
  expect(ranked.data.map((row) => row.personaId)).toEqual([mai.id, astr.id]);
  for (const row of ranked.data) {
    const found = hot.data.find((entry) => entry.personaId === row.personaId);
    expect(found?.heatMetric?.eligibleExports).toBe(row.eligibleExports);
    expect(found?.heatMetric?.score).toBeCloseTo(row.score, 3);
  }
  for (const row of result.data) {
    expect(row).not.toHaveProperty('metricCount');
    expect(row).not.toHaveProperty('ownerId');
    expect(row.snapshot).not.toHaveProperty('content');
    expect(row.snapshot).not.toHaveProperty('readmeMarkdown');
  }
  const filtered = await list({
    sort: 'downloads',
    q: '公开 README 搜索标记',
    platform: 'astrbot',
    categoryId,
    tagIds: tagId,
    model: 'Qwen/星海-Model',
    origin: 'original',
    hasDialogue: 'true',
    publishedWithin: '7d',
  });
  expect(filtered.data.map((row) => row.personaId)).toEqual([astr.id]);
  expect(filtered.meta).toMatchObject({ total: 1, capped: false });
  expect(filtered.data[0]?.exportMetric).toEqual({ eligibleExports: 2, window: 'all' });
  const first = await list({ sort: 'downloads', pageSize: '1' });
  const second = await list({ sort: 'downloads', pageSize: '1', page: '2' });
  expect(first.data[0]?.personaId).toBe(mai.id);
  expect(second.data[0]?.personaId).toBe(astr.id);
  expect((await list({ sort: 'updated' })).data.every((row) => !row.exportMetric)).toBe(true);
  expect(
    (
      await author.http.write('/api/v1/me/personas/' + mai.id + '/visibility', {
        visibility: 'hidden',
        reason: '公开排序下架验收',
      })
    ).status,
  ).toBe(200);
  for (const sort of ['downloads', 'recent-downloads', 'hot'])
    expect((await list({ sort })).data.map((row) => row.personaId)).toEqual([astr.id, zero.id]);
});

it('旧作3次导出在时间衰减后低于新作2次，零导出新作品保留展示机会', async () => {
  const author = await verifiedCreator(stack);
  const admin = await stack.admin();
  const fresh = await publish(author.http, admin.http);
  const zero = await publish(author.http, admin.http, 'astrbot');
  const client = await stack.owner.pool.connect();
  let older: { id: string; releaseId: string };
  try {
    older = await seedRankingHistory(
      client,
      fresh.id,
      new Date(Date.now() - 60 * 86400000),
      new Date(Date.now() - 10 * 86400000),
    );
  } finally {
    client.release();
  }
  for (let index = 0; index < 3; index++) await download(stack.browser(), older);
  for (let index = 0; index < 2; index++) await download(stack.browser(), fresh);
  for (const table of [
    'export_daily_metrics',
    'export_version_daily_metrics',
    'export_version_subject_days',
  ] as const)
    await stack.owner.pool.query(
      `UPDATE ${table} SET day=(now() AT TIME ZONE 'UTC')::date-6 WHERE persona_id=$1`,
      [older.id],
    );
  await stack.owner.pool.query(
    "UPDATE export_subject_days SET day=(now() AT TIME ZONE 'UTC')::date-6,created_at=now()-interval '6 days' WHERE persona_id=$1",
    [older.id],
  );
  expect((await list()).data.map((row) => row.personaId)).toEqual([older.id, fresh.id, zero.id]);
  const hot = await list({ sort: 'hot' });
  expect(hot.data.map((row) => row.personaId)).toEqual([fresh.id, older.id, zero.id]);
  expect(hot.data[1]?.heatMetric?.score).toBeCloseTo(3 * Math.pow(0.5, 6 / 7), 3);
  expect(hot.data[2]?.heatMetric?.score).toBe(0);
});

it('近7天按UTC日期包含第6天、排除第7天和未来日期，累计计数保留历史事实', async () => {
  const author = await verifiedCreator(stack);
  const admin = await stack.admin();
  const template = await publish(author.http, admin.http);
  const client = await stack.owner.pool.connect();
  const samples: Array<{ id: string; releaseId: string; offset: number; count: number }> = [];
  try {
    for (const [offset, count] of [
      [-7, 2],
      [-6, 1],
      [1, 1],
    ] as const) {
      const history = await seedRankingHistory(
        client,
        template.id,
        new Date(Date.now() - 60 * 86400000),
        new Date(Date.now() - 86400000),
      );
      samples.push({ ...history, offset, count });
    }
  } finally {
    client.release();
  }
  expect(
    (
      await author.http.write('/api/v1/me/personas/' + template.id + '/visibility', {
        visibility: 'hidden',
        reason: '历史样本基准不参与排序',
      })
    ).status,
  ).toBe(200);
  for (const sample of samples) {
    for (let index = 0; index < sample.count; index++) await download(stack.browser(), sample);
    // 隔离测试库的完整日期事实一起移动，不改写不可变作品和审核记录
    for (const table of [
      'export_daily_metrics',
      'export_version_daily_metrics',
      'export_version_subject_days',
    ] as const)
      await stack.owner.pool.query(
        `UPDATE ${table} SET day=(now() AT TIME ZONE 'UTC')::date+$1::integer WHERE persona_id=$2`,
        [sample.offset, sample.id],
      );
    await stack.owner.pool.query(
      "UPDATE export_subject_days SET day=(now() AT TIME ZONE 'UTC')::date+$1::integer,created_at=now()+$1::integer*interval '1 day' WHERE persona_id=$2",
      [sample.offset, sample.id],
    );
  }
  for (const [sort, window, counts] of [
    ['downloads', 'all', [2, 1, 0]],
    ['recent-downloads', '7d', [0, 1, 0]],
  ] as const) {
    const result = await list({ sort });
    expect(result.data).toHaveLength(3);
    for (const [index, sample] of samples.entries())
      expect(result.data.find((row) => row.personaId === sample.id)?.exportMetric).toEqual({
        eligibleExports: counts[index],
        window,
      });
    expect(result.data[0]?.personaId).toBe(samples[sort === 'downloads' ? 0 : 1]?.id);
  }
});

it('无数据与非法排序有明确结果，真实聚合表锁超时可重试且不污染普通排序连接', async () => {
  expect((await list()).data).toEqual([]);
  expect((await stack.browser().raw('/api/v1/personas?sort=downloads;SELECT')).status).toBe(400);
  const author = await verifiedCreator(stack);
  const admin = await stack.admin();
  await publish(author.http, admin.http);
  const client = await stack.owner.pool.connect();
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE export_daily_metrics IN ACCESS EXCLUSIVE MODE');
    const response = await stack.browser().raw('/api/v1/personas?sort=recent-downloads');
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    const body: unknown = await response.json();
    expect(body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(JSON.stringify(body)).not.toContain('statement_timeout');
    expect((await list({ sort: 'newest' })).data).toHaveLength(1);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect((await list()).data[0]?.exportMetric).toEqual({ eligibleExports: 0, window: 'all' });
});
