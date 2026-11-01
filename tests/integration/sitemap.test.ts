import { moderatePersona } from '../fixtures/admin-persona-moderation.js';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import {
  PublicSitemapIndexResponseSchema,
  PublicSitemapEntriesResponseSchema,
  PublicReleaseResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
async function index() {
  const response = await stack.browser().raw('/api/v1/public/sitemap/index');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return PublicSitemapIndexResponseSchema.parse(await response.json()).data;
}
async function entries(page = 1) {
  const response = await stack.browser().raw('/api/v1/public/sitemap/entries?page=' + page);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return PublicSitemapEntriesResponseSchema.parse(await response.json()).data;
}
async function submit(
  http: AuthHttp,
  persona: { id: string; revision: number },
  version = '1.0.0',
) {
  const response = await http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    { version, expectedDraftRevision: persona.revision, changelog: '真实SEO版本', confirmed: true },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(response.status).toBe(200);
  return SubmissionResponseSchema.parse(await response.json()).data;
}
async function approve(reviewer: AuthHttp, submission: { id: string }) {
  expect(
    (
      await reviewer.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: 1,
          reason: '核对公开SEO样本',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
}
async function current(id: string) {
  return PublicReleaseResponseSchema.parse(
    await (await stack.browser().raw('/api/v1/personas/' + id)).json(),
  ).data;
}
it('空地图和非法输入明确返回；只列当前已审核版本，不泄漏草稿、待审及历史快照', async () => {
  expect(await index()).toEqual({ total: 0, pageSize: 1000, pages: 0 });
  expect(await entries()).toEqual([]);
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=50000', 'page=1&page=2', 'q=private'])
    expect((await stack.browser().raw('/api/v1/public/sitemap/entries?' + query)).status).toBe(400);
  const author = await verifiedCreator(stack);
  const reviewer = await stack.admin();
  await completePersona(author.http);
  const pending = await completePersona(author.http, 'astrbot');
  await submit(author.http, pending);
  const published = await completePersona(author.http);
  const first = await submit(author.http, published);
  await approve(reviewer.http, first);
  expect(await index()).toEqual({ total: 1, pageSize: 1000, pages: 1 });
  expect(await entries()).toEqual([
    { personaId: published.id, publishedAt: (await current(published.id)).publishedAt },
  ]);
  const second = await submit(author.http, published, '1.0.1');
  await approve(reviewer.http, second);
  const latest = await current(published.id);
  expect(latest.releaseId).toBe(second.releaseId);
  expect(await entries()).toEqual([{ personaId: published.id, publishedAt: latest.publishedAt }]);
  expect(await entries(2)).toEqual([]);
  expect((await index()).total).toBe(1);
  expect(
    (await stack.browser().raw('/api/v1/personas/' + published.id + '/releases/' + first.releaseId))
      .status,
  ).toBe(200);
});
it('隐藏、管理员封禁与撤回即时移除，解除封禁不绕过作者隐藏或自动选择历史版本', async () => {
  const author = await verifiedCreator(stack);
  const reviewer = await stack.admin();
  const persona = await completePersona(author.http);
  const first = await submit(author.http, persona);
  await approve(reviewer.http, first);
  const next = await submit(author.http, persona, '1.0.1');
  await approve(reviewer.http, next);
  const visibility = async (visibility: 'hidden' | 'listed') => {
    expect(
      (
        await author.http.write('/api/v1/me/personas/' + persona.id + '/visibility', {
          visibility,
          reason: '核对SEO可见性',
        })
      ).status,
    ).toBe(200);
  };
  const moderation = async (state: 'blocked' | 'normal') => {
    expect(
      (
        await moderatePersona(reviewer.http, persona.id, {
          state,
          reason: '核对SEO下架边界',
        })
      ).status,
    ).toBe(200);
  };
  expect((await index()).total).toBe(1);
  await visibility('hidden');
  expect(await entries()).toEqual([]);
  await moderation('blocked');
  await moderation('normal');
  expect((await index()).total).toBe(0);
  await visibility('listed');
  expect((await index()).total).toBe(1);
  await moderation('blocked');
  expect(await entries()).toEqual([]);
  await moderation('normal');
  expect((await entries())[0]?.personaId).toBe(persona.id);
  expect(
    (
      await author.http.write(
        '/api/v1/me/personas/' + persona.id + '/releases/' + next.releaseId + '/state',
        { action: 'withdraw', reason: '核对当前版本撤回' },
      )
    ).status,
  ).toBe(200);
  expect(await entries()).toEqual([]);
  expect((await index()).total).toBe(0);
  expect(
    (await stack.browser().raw('/api/v1/personas/' + persona.id + '/releases/' + first.releaseId))
      .status,
  ).toBe(200);
});
it('真实表锁触发两秒读取预算，返回可重试503，释放后可恢复且没有假空地图', async () => {
  const keeper = await stack.owner.pool.connect();
  try {
    await keeper.query('BEGIN');
    await keeper.query('LOCK TABLE personas IN ACCESS EXCLUSIVE MODE');
    const response = await stack.browser().raw('/api/v1/public/sitemap/index');
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
  } finally {
    await keeper.query('ROLLBACK');
    keeper.release();
  }
  expect((await index()).total).toBe(0);
});
it('站点地图索引与分片共用真实访客限流，伪造未受信代理头不能换配额', async () => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const path = attempt % 2 ? '/api/v1/public/sitemap/index' : '/api/v1/public/sitemap/entries';
    const response = await stack
      .browser()
      .raw(path, { headers: { 'x-forwarded-for': '203.0.113.' + (attempt + 1) } });
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  }
  const limited = await stack
    .browser()
    .raw('/api/v1/public/sitemap/index', { headers: { 'x-forwarded-for': '198.51.100.1' } });
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
});
