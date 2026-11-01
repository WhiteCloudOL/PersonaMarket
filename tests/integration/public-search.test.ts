import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { seedSearchLoad } from '../fixtures/search-load.js';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  DraftResponseSchema,
  SubmissionResponseSchema,
  PublicPersonaListResponseSchema,
  PersonaDraftSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator, completePersona } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
let author: Awaited<ReturnType<typeof verifiedCreator>>;
const ids: string[] = [];
const firstTag = '20000000-0000-4000-8000-000000000001';
const secondTag = '20000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  stack = await createAuthStack();
  author = await verifiedCreator(stack);
  const admin = await stack.admin();
  for (let index = 0; index < 3; index++) {
    const created = await completePersona(author.http, index === 2 ? 'astrbot' : 'maibot');
    const draft = PersonaDraftSchema.parse({
      ...created.draft,
      categoryId: '10000000-0000-4000-8000-000000000001',
      title: index === 0 ? '星河' : index === 1 ? '林间向导' : '书页旅行者',
      summary: index === 1 ? '星河里的温柔相遇' : '真实公开的角色资料',
      tagIds: index === 0 ? [firstTag, secondTag] : [firstTag],
      readmeMarkdown: '# 作者介绍\n\n月光读书会与 literal%_\\ 标记',
      recommendedModels: [{ modelId: 'Qwen/星海-Model-3.5', note: '作者填写' }],
      ...(created.draft.platform === 'astrbot'
        ? {
            platform: 'astrbot',
            content: {
              systemPrompt: '保存完整人格',
              dialoguePairs: [{ id: randomUUID(), user: '你好', assistant: '欢迎' }],
            },
          }
        : {}),
    });
    expect(
      (
        await author.http.write('/api/v1/me/personas/' + created.id + '/draft', draft, 'PUT', {
          'If-Match': '"draft-2"',
        })
      ).status,
    ).toBe(200);
    const submission = await author.http.write(
      '/api/v1/me/personas/' + created.id + '/releases',
      {
        version: '1.0.0',
        expectedDraftRevision: 3,
        changelog: '真实搜索样例',
        confirmed: true,
      },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(submission.status).toBe(200);
    const item = SubmissionResponseSchema.parse(await submission.json()).data;
    expect(
      (
        await admin.http.write(
          '/api/v1/admin/moderation/submissions/' + item.id + '/review',
          {
            action: 'approve',
            expectedRevision: 1,
            reason: '核实来源与完整内容',
            selfReviewConfirmed: false,
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(200);
    ids.push(created.id);
  }
});
afterAll(async () => {
  await stack?.close();
});

async function list(query: Record<string, string>) {
  const response = await stack.browser().raw('/api/v1/personas?' + new URLSearchParams(query));
  expect(response.status).toBe(200);
  return PublicPersonaListResponseSchema.parse(await response.json());
}
it('中文单字双字、作者、冻结标签、README和混合模型均可搜索，标题优先且通配符按字面匹配', async () => {
  expect((await list({ q: '星', sort: 'relevance' })).data[0]?.personaId).toBe(ids[0]);
  expect((await list({ q: '星河', sort: 'relevance' })).data.map((item) => item.personaId)).toEqual(
    [ids[0], ids[1]],
  );
  for (const q of [author.username, '温柔治愈', '月光读书会', '星海-Model', 'literal%_\\']) {
    expect((await list({ q })).meta.total).toBe(3);
  }
  const cards = await list({ q: '星河' });
  expect(cards.data[0]?.snapshot).not.toHaveProperty('content');
  expect(cards.data[0]?.snapshot).not.toHaveProperty('readmeMarkdown');
  expect(cards.data[0]).not.toHaveProperty('changelog');
  expect((await list({ q: 'missing%_' })).meta.total).toBe(0);
});
it('多标签为AND，结合平台、对话与时间筛选，并限制深分页与非法排序', async () => {
  expect(
    (await list({ tagIds: firstTag + ',' + secondTag })).data.map((item) => item.personaId),
  ).toEqual([ids[0]]);
  expect(
    (
      await list({
        tagIds: firstTag,
        platform: 'astrbot',
        hasDialogue: 'true',
        publishedWithin: '7d',
      })
    ).data.map((item) => item.personaId),
  ).toEqual([ids[2]]);
  expect((await list({ platform: 'maibot', hasDialogue: 'true' })).meta.total).toBe(0);
  for (const query of [
    { sort: 'sql' },
    { tagIds: 'invalid' },
    { q: '星', page: '101' },
    { hasDialogue: 'anything' },
  ]) {
    expect(
      (await stack.browser().raw('/api/v1/personas?' + new URLSearchParams(query))).status,
    ).toBe(400);
  }
});
it('补丁发布更新当前搜索投影但保留首次公开时间', async () => {
  const id = ids[1];
  if (!id) throw new Error('缺少公开作品');
  const before = (await list({ q: '林间向导' })).data[0];
  const submitted = await author.http.write(
    '/api/v1/me/personas/' + id + '/releases',
    {
      version: '1.0.1',
      expectedDraftRevision: 3,
      changelog: '更新说明',
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(submitted.status).toBe(200);
  const item = SubmissionResponseSchema.parse(await submitted.json()).data;
  const admin = await stack.admin();
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + item.id + '/review',
        {
          action: 'approve',
          expectedRevision: 1,
          reason: '核对更新内容',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const after = (await list({ q: '林间向导', sort: 'updated' })).data[0];
  expect(after?.version).toBe('1.0.1');
  expect(after?.releaseId).not.toBe(before?.releaseId);
  expect(after?.firstPublishedAt).toBe(before?.firstPublishedAt);
  expect(Date.parse(after?.publishedAt ?? '')).toBeGreaterThan(
    Date.parse(before?.publishedAt ?? ''),
  );
});
it('不读取编辑中的私有README，隐藏后即使旧投影仍存在也不能搜索或计数', async () => {
  const id = ids[0];
  if (!id) throw new Error('缺少已公开作品');
  const path = '/api/v1/me/personas/' + id;
  const response = await author.http.raw(path + '/draft');
  const saved = DraftResponseSchema.parse(await response.json());
  expect(
    (
      await author.http.write(
        path + '/draft',
        {
          ...saved.data.draft,
          readmeMarkdown: '私密草稿绝不公开',
        },
        'PUT',
        { 'If-Match': '"draft-3"' },
      )
    ).status,
  ).toBe(200);
  expect((await list({ q: '私密草稿绝不公开' })).meta.total).toBe(0);
  const stale = await stack.owner.pool.query<{ value: unknown }>(
    'SELECT to_jsonb(p) AS value FROM persona_public_projection p WHERE persona_id=$1',
    [id],
  );
  expect(stale.rows[0]?.value).toBeTruthy();
  expect(
    (
      await author.http.write(path + '/visibility', {
        visibility: 'hidden',
        reason: '测试下架搜索资格',
      })
    ).status,
  ).toBe(200);
  await stack.owner.pool.query(
    'INSERT INTO persona_public_projection SELECT * FROM jsonb_populate_record(NULL::persona_public_projection,$1::jsonb) ON CONFLICT (persona_id) DO NOTHING',
    [JSON.stringify(stale.rows[0]?.value)],
  );
  expect((await list({ q: '星河' })).data.map((item) => item.personaId)).toEqual([ids[1]]);
});

describe('一万作品真实搜索边界', () => {
  const records: Array<{ q: string; milliseconds: number; total: number }> = [];
  beforeAll(async () => {
    const template = ids[1];
    if (!template) throw new Error('缺少真实审核模板');
    const client = await stack.owner.pool.connect();
    try {
      for (let batch = 0; batch < 10; batch++) await seedSearchLoad(client, template, 1000);
      await client.query('ANALYZE personas');
      await client.query('VACUUM (ANALYZE) persona_public_projection');
    } finally {
      client.release();
    }
  });
  it.each(['星', '星辰', 'benchmark-token-rare'])('搜索 %s 的上限分页稳定', async (q) => {
    const start = performance.now();
    const result = await list({ q, pageSize: '100' });
    records.push({
      q,
      milliseconds: Math.round(performance.now() - start),
      total: result.meta.total,
    });
    expect(result.meta).toMatchObject({ total: 1000, capped: true });
    expect(result.data).toHaveLength(100);
    const second = await list({ q, pageSize: '100', page: '2' });
    expect(new Set([...result.data, ...second.data].map((item) => item.personaId)).size).toBe(200);
    expect((await list({ q, pageSize: '100', page: '10' })).data).toHaveLength(100);
  });
  it('选择性查询真实使用三元索引并保存测量结果', async () => {
    const broadPlan = await stack.owner.pool.query(
      `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT persona_id FROM persona_public_projection WHERE search_text ILIKE '%benchmark-token-rare%'`,
    );
    const selectivePlan = await stack.owner.pool.query(
      `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT persona_id FROM persona_public_projection WHERE search_text ILIKE '%月光读书会%'`,
    );
    expect(JSON.stringify(selectivePlan.rows)).toContain('projection_search_trgm_idx');
    await mkdir('data/tests/public-search', { recursive: true });
    await writeFile(
      'data/tests/public-search/performance.json',
      JSON.stringify(
        {
          sampleSize: 10003,
          records,
          broadPlan: broadPlan.rows,
          selectivePlan: selectivePlan.rows,
        },
        null,
        2,
      ),
    );
  });
});
it('实际数据库锁等待触发搜索超时后返回可重试错误，连接池配置恢复', async () => {
  const client = await stack.owner.pool.connect();
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE persona_public_projection IN ACCESS EXCLUSIVE MODE');
    const response = await stack.browser().raw('/api/v1/personas?q=星');
    expect(response.status).toBe(503);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(JSON.stringify(body)).not.toContain('statement_timeout');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect((await list({ q: '林间向导' })).meta.total).toBe(1);
});
