import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AdminGuideResponseSchema,
  AdminGuidesResponseSchema,
  PublicGuideResponseSchema,
  PublicGuidesResponseSchema,
  GuideSitemapResponseSchema,
  GuideRecordsResponseSchema,
  GuideFieldsSchema,
  GuideSlugSchema,
  AuthContextResponseSchema,
  guideEtag,
  type GuideWrite,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const path = '/api/v1/admin/guides/maibot';
const input: GuideWrite = {
  title: '新的使用指南标题',
  summary: '核对本次指南变化',
  bodyMarkdown: '  ## 新的编辑稿\n\n保留原始空白  ',
  reason: '按实际操作核对指南',
};
const write = (http: AuthHttp, expected: number, body = input, key = randomUUID()) =>
  http.write(path, body, 'PATCH', {
    'If-Match': guideEtag('maibot', expected),
    'Idempotency-Key': key,
  });
const action = (
  http: AuthHttp,
  expected: number,
  name: 'publish' | 'withdraw',
  key = randomUUID(),
) =>
  http.write(
    path + '/actions/' + name,
    { reason: '确认' + name + '的可见范围', confirmed: true },
    'POST',
    { 'If-Match': guideEtag('maibot', expected), 'Idempotency-Key': key },
  );
async function read(http: AuthHttp) {
  const response = await http.raw(path);
  expect(response.status).toBe(200);
  const result = AdminGuideResponseSchema.parse(await response.json());
  expect(response.headers.get('etag')).toBe(guideEtag('maibot', result.data.revision));
  expect(response.headers.get('cache-control')).toContain('no-store');
  return result;
}
const publicRead = (http: AuthHttp) => http.raw('/api/v1/site/guides/maibot');

it('九章原指南公开且白名单安全，编辑稿不改变当前公开快照和站点地图', async () => {
  const guest = stack.browser();
  const publicResponse = await guest.raw('/api/v1/site/guides');
  expect(publicResponse.status).toBe(200);
  expect(publicResponse.headers.get('cache-control')).toContain('no-store');
  const text = await publicResponse.text();
  for (const field of ['actorId', 'updatedBy', 'contentHash', 'revision', 'originalText'])
    expect(text).not.toContain('"' + field + '"');
  const publicData = PublicGuidesResponseSchema.parse(JSON.parse(text)).data;
  const original = z
    .array(GuideFieldsSchema.extend({ slug: GuideSlugSchema, originalText: z.string() }))
    .parse(
      JSON.parse(
        await readFile(new URL('../fixtures/guides-initial.json', import.meta.url), 'utf8'),
      ),
    );
  expect(publicData.map((row) => row.slug)).toEqual(GuideSlugSchema.options);
  for (const row of original)
    expect(publicData.find((guide) => guide.slug === row.slug)).toMatchObject({
      title: row.title,
      summary: row.summary,
      bodyMarkdown: row.bodyMarkdown,
    });
  const admin = await stack.admin();
  const account = AuthContextResponseSchema.parse(
    await (await admin.http.raw('/api/v1/auth/context')).json(),
  ).data.account;
  if (!account) throw new Error('缺少隔离管理员');
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '20 minutes' WHERE user_id=$1",
    [account.id],
  );
  const initial = await read(admin.http);
  expect(initial.data).toMatchObject({
    revision: 1,
    status: 'published',
    hasUnpublishedChanges: false,
    updatedBy: null,
  });
  const before = PublicGuideResponseSchema.parse(await (await publicRead(guest)).json());
  const sitemap = GuideSitemapResponseSchema.parse(
    await (await guest.raw('/api/v1/site/guide-sitemap')).json(),
  );
  expect(sitemap.data).toHaveLength(9);
  const saved = await write(admin.http, 1);
  expect(saved.status).toBe(200);
  expect(AdminGuideResponseSchema.parse(await saved.json()).data).toMatchObject({
    revision: 2,
    hasUnpublishedChanges: true,
    updatedBy: account.username,
    bodyMarkdown: input.bodyMarkdown,
    published: before.data,
  });
  expect(PublicGuideResponseSchema.parse(await (await publicRead(guest)).json())).toEqual(before);
  expect(
    GuideSitemapResponseSchema.parse(await (await guest.raw('/api/v1/site/guide-sitemap')).json()),
  ).toEqual(sitemap);
  expect(
    AdminGuidesResponseSchema.parse(
      await (await admin.http.raw('/api/v1/admin/guides?q=新的使用&status=published')).json(),
    ).data,
  ).toHaveLength(1);
});

it('发布、撤回和再次发布使用独立不可变快照，幂等请求不会重复生成记录', async () => {
  const admin = await stack.admin(),
    guest = stack.browser();
  const initial = await read(admin.http);
  expect((await write(admin.http, 1)).status).toBe(200);
  const key = randomUUID();
  const published = await action(admin.http, 2, 'publish', key);
  expect(published.status).toBe(200);
  const result = AdminGuideResponseSchema.parse(await published.json());
  expect(result.data).toMatchObject({
    revision: 3,
    status: 'published',
    hasUnpublishedChanges: false,
  });
  expect(result.data.published?.bodyMarkdown).toBe(input.bodyMarkdown);
  expect(result.data.published?.publicationId).not.toBe(initial.data.published?.publicationId);
  expect((await action(admin.http, 2, 'publish', key)).status).toBe(200);
  expect((await action(admin.http, 3, 'publish')).status).toBe(409);
  expect((await write(admin.http, 3)).status).toBe(409);
  const publication = await stack.owner.pool.query(
    'SELECT id,body_markdown FROM guide_publications WHERE slug=$1 ORDER BY created_at,id',
    ['maibot'],
  );
  expect(publication.rowCount).toBe(2);
  expect(
    publication.rows.find((row) => row.id === initial.data.published?.publicationId)?.body_markdown,
  ).toBe(initial.data.bodyMarkdown);
  expect((await action(admin.http, 3, 'withdraw')).status).toBe(200);
  const hidden = await publicRead(guest);
  expect(hidden.status).toBe(404);
  expect(await hidden.text()).not.toContain(input.bodyMarkdown);
  expect(
    PublicGuidesResponseSchema.parse(
      await (await guest.raw('/api/v1/site/guides')).json(),
    ).data.some((row) => row.slug === 'maibot'),
  ).toBe(false);
  expect(
    GuideSitemapResponseSchema.parse(
      await (await guest.raw('/api/v1/site/guide-sitemap')).json(),
    ).data.some((row) => row.slug === 'maibot'),
  ).toBe(false);
  expect((await action(admin.http, 4, 'publish')).status).toBe(200);
  expect(
    PublicGuideResponseSchema.parse(await (await publicRead(guest)).json()).data.bodyMarkdown,
  ).toBe(input.bodyMarkdown);
  const records = GuideRecordsResponseSchema.parse(
    await (await admin.http.raw(path + '/records')).json(),
  );
  expect(records.meta.total).toBe(4);
  expect(records.data.map((row) => row.action)).toEqual([
    'published',
    'withdrawn',
    'published',
    'edited',
  ]);
  expect(records.data.at(-1)?.before.bodyMarkdown).toBe(initial.data.bodyMarkdown);
  expect(records.data.at(-1)?.after.bodyMarkdown).toBe(input.bodyMarkdown);
  const record = records.data[0];
  if (!record) throw new Error('缺少真实记录');
  await expect(
    stack.owner.pool.query('UPDATE guide_records SET reason=$2 WHERE id=$1', [
      record.id,
      '篡改理由',
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    stack.owner.pool.query('DELETE FROM guide_publications WHERE id=$1', [
      initial.data.published?.publicationId,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
});

it('并发只允许一个修订，错误幂等重放、非法章节和不完整确认均明确拒绝', async () => {
  const admin = await stack.admin();
  const responses = await Promise.all(
    ['第一份编辑', '另一份编辑'].map((title) => write(admin.http, 1, { ...input, title })),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
  const current = await read(admin.http);
  expect(current.data.revision).toBe(2);
  const key = randomUUID();
  expect((await write(admin.http, 2, input, key)).status).toBe(200);
  expect((await write(admin.http, 2, { ...input, reason: '同一标识不同请求' }, key)).status).toBe(
    409,
  );
  for (const body of [
    { ...input, reason: '' },
    { ...input, role: 'admin' },
    { ...input, title: '前后空格 ' },
    { ...input, bodyMarkdown: '\u0000' },
  ])
    expect(
      (
        await admin.http.write(path, body, 'PATCH', {
          'If-Match': guideEtag('maibot', 3),
          'Idempotency-Key': randomUUID(),
        })
      ).status,
    ).toBe(400);
  expect(
    (await admin.http.write(path, input, 'PATCH', { 'Idempotency-Key': randomUUID() })).status,
  ).toBe(400);
  expect(
    (await admin.http.write(path, input, 'PATCH', { 'If-Match': guideEtag('maibot', 3) })).status,
  ).toBe(400);
  expect(
    (
      await admin.http.write(path + '/actions/publish', { reason: '缺少明确确认' }, 'POST', {
        'If-Match': guideEtag('maibot', 3),
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(400);
  expect((await admin.http.raw('/api/v1/admin/guides/license')).status).toBe(400);
  expect((await admin.http.raw(path + '/records?page=101')).status).toBe(400);
});

it('匿名、普通作者和审核员无权管理，账号核对、CSRF和会话撤权即时生效', async () => {
  expect((await stack.browser().raw(path)).status).toBe(401);
  const author = await verifiedCreator(stack);
  expect((await author.http.raw(path)).status).toBe(403);
  expect((await write(author.http, 1)).status).toBe(403);
  expect((await author.http.raw(path + '/records')).status).toBe(403);
  await stack.owner.pool.query("UPDATE users SET role='moderator' WHERE username=$1", [
    author.username,
  ]);
  const moderator = stack.browser();
  expect(
    (
      await moderator.write('/api/v1/auth/login', {
        identifier: author.username,
        password: author.password,
      })
    ).status,
  ).toBe(200);
  expect((await moderator.raw(path)).status).toBe(403);
  expect((await action(moderator, 1, 'withdraw')).status).toBe(403);
  const admin = await stack.admin();
  expect(
    (await admin.http.raw(path, { headers: { 'X-Expected-Account': randomUUID() } })).status,
  ).toBe(409);
  expect(
    (
      await admin.http.raw(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(403);
  const account = AuthContextResponseSchema.parse(
    await (await admin.http.raw('/api/v1/auth/context')).json(),
  ).data.account;
  if (!account) throw new Error('缺少隔离管理员');
  await stack.admin();
  await stack.owner.pool.query("UPDATE users SET status='banned' WHERE id=$1", [account.id]);
  expect((await admin.http.raw(path)).status).toBe(401);
});

it('公共读取超时可重试，九章全部撤回后返回真实空列表和空站点地图', async () => {
  const guest = stack.browser(),
    lock = await stack.owner.pool.connect();
  try {
    await lock.query('BEGIN');
    await lock.query('LOCK TABLE guide_entries IN ACCESS EXCLUSIVE MODE');
    const unavailable = await guest.raw('/api/v1/site/guides');
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error.code).toBe('SERVICE_UNAVAILABLE');
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
  const admin = await stack.admin();
  for (const slug of GuideSlugSchema.options) {
    const response = await admin.http.write(
      '/api/v1/admin/guides/' + slug + '/actions/withdraw',
      { reason: '核对整站指南空态', confirmed: true },
      'POST',
      { 'If-Match': guideEtag(slug, 1), 'Idempotency-Key': randomUUID() },
    );
    expect(response.status).toBe(200);
  }
  expect(
    PublicGuidesResponseSchema.parse(await (await guest.raw('/api/v1/site/guides')).json()).data,
  ).toEqual([]);
  expect(
    GuideSitemapResponseSchema.parse(await (await guest.raw('/api/v1/site/guide-sitemap')).json())
      .data,
  ).toEqual([]);
});
