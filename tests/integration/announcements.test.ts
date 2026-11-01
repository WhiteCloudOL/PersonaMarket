import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '@personamarket/database';
import {
  AnnouncementSitemapResponseSchema,
  AdminAnnouncementResponseSchema,
  AdminAnnouncementsResponseSchema,
  AnnouncementRecordsResponseSchema,
  AuthContextResponseSchema,
  PublicAnnouncementResponseSchema,
  PublicAnnouncementsResponseSchema,
  announcementEtag,
  type AnnouncementWrite,
  type ManagedAnnouncement,
  type AnnouncementActionName,
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
const base = '/api/v1/admin/announcements';
const input: AnnouncementWrite = {
  title: '第一份公开公告',
  summary: '真实运营消息',
  body: '公告原文\n保留换行',
  pinned: false,
  reason: '首次整理站点公告',
};
async function create(http: AuthHttp, value = input, key = randomUUID()) {
  const response = await http.write(base, value, 'POST', { 'Idempotency-Key': key });
  expect(response.status).toBe(200);
  const row = AdminAnnouncementResponseSchema.parse(await response.json()).data;
  expect(response.headers.get('etag')).toBe(announcementEtag(row.id, row.revision));
  return row;
}
async function state(
  http: AuthHttp,
  row: ManagedAnnouncement,
  action: AnnouncementActionName,
  key = randomUUID(),
) {
  const response = await http.write(
    base + '/' + row.id + '/' + action,
    { reason: '核对' + action + '后的真实状态', confirmed: true },
    'POST',
    { 'Idempotency-Key': key, 'If-Match': announcementEtag(row.id, row.revision) },
  );
  expect(response.status).toBe(200);
  return AdminAnnouncementResponseSchema.parse(await response.json()).data;
}
async function edit(http: AuthHttp, row: ManagedAnnouncement, value: AnnouncementWrite) {
  const response = await http.write(base + '/' + row.id, value, 'PATCH', {
    'Idempotency-Key': randomUUID(),
    'If-Match': announcementEtag(row.id, row.revision),
  });
  expect(response.status).toBe(200);
  return AdminAnnouncementResponseSchema.parse(await response.json()).data;
}
async function publicList(query = '') {
  const response = await stack.browser().raw('/api/v1/announcements' + query);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  return PublicAnnouncementsResponseSchema.parse(await response.json());
}

it('普通管理员会话完整维护公告，编辑稿不提前公开，幂等操作和归档恢复均追加记录', async () => {
  const admin = await stack.admin();
  const account = AuthContextResponseSchema.parse(
    await (await admin.http.raw('/api/v1/auth/context')).json(),
  ).data.account;
  if (!account) throw new Error('缺少隔离测试管理员');
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '20 minutes' WHERE user_id=$1",
    [account.id],
  );
  const key = randomUUID();
  let row = await create(admin.http, input, key);
  expect(row).toMatchObject({ status: 'draft', published: null, revision: 1 });
  expect((await create(admin.http, input, key)).id).toBe(row.id);
  expect(
    (
      await admin.http.write(base, { ...input, title: '同键不同内容' }, 'POST', {
        'Idempotency-Key': key,
      })
    ).status,
  ).toBe(409);
  const publicPath = '/api/v1/announcements/' + row.id;
  expect((await stack.browser().raw(publicPath)).status).toBe(404);
  expect((await publicList()).meta.total).toBe(0);
  expect(
    AnnouncementSitemapResponseSchema.parse(
      await (await stack.browser().raw('/api/v1/site/announcement-sitemap')).json(),
    ).data,
  ).toEqual([]);
  const publishKey = randomUUID();
  const original = row;
  row = await state(admin.http, row, 'publish', publishKey);
  expect((await state(admin.http, original, 'publish', publishKey)).revision).toBe(2);
  const firstPublished = row.published?.firstPublishedAt;
  const privateBody = '尚未发布的编辑文字 <script>alert(1)</script>';
  row = await edit(admin.http, row, {
    ...input,
    title: '编辑中的新标题',
    body: privateBody,
    pinned: true,
  });
  expect(row).toMatchObject({ revision: 3, status: 'published', hasUnpublishedChanges: true });
  const live = await stack.browser().raw(publicPath);
  const liveText = await live.text();
  expect(liveText).not.toContain(privateBody);
  expect(PublicAnnouncementResponseSchema.parse(JSON.parse(liveText)).data).toMatchObject({
    title: input.title,
    body: input.body,
    pinned: false,
  });
  expect((await publicList()).data[0]?.title).toBe(input.title);
  row = await state(admin.http, row, 'publish');
  expect(row.published).toMatchObject({
    title: row.title,
    body: privateBody,
    firstPublishedAt: firstPublished,
  });
  row = await state(admin.http, row, 'withdraw');
  expect((await stack.browser().raw(publicPath)).status).toBe(404);
  row = await state(admin.http, row, 'archive');
  row = await state(admin.http, row, 'restore');
  expect(row.status).toBe('withdrawn');
  expect((await publicList()).meta.total).toBe(0);
  row = await state(admin.http, row, 'publish');
  expect((await publicList()).meta.total).toBe(1);
  expect(
    AnnouncementSitemapResponseSchema.parse(
      await (await stack.browser().raw('/api/v1/site/announcement-sitemap')).json(),
    ).data.map((item) => item.id),
  ).toEqual([row.id]);
  const recordsResponse = await admin.http.raw(base + '/' + row.id + '/records');
  expect(recordsResponse.status).toBe(200);
  const records = AnnouncementRecordsResponseSchema.parse(await recordsResponse.json());
  expect(records.meta.total).toBe(8);
  expect(records.data.map((record) => record.action)).toEqual([
    'published',
    'restored',
    'archived',
    'withdrawn',
    'published',
    'edited',
    'published',
    'created',
  ]);
  expect(JSON.stringify(records)).not.toContain(privateBody);
  const record = records.data[0];
  if (!record) throw new Error('缺少实际公告记录');
  await expect(
    stack.owner.pool.query('UPDATE announcement_records SET reason=$2 WHERE id=$1', [
      record.id,
      '不能改写',
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  const application = createDatabase(stack.env.DATABASE_URL);
  try {
    await expect(
      application.pool.query('DELETE FROM announcement_records WHERE id=$1', [record.id]),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await application.pool.end();
  }
});

it('并发编辑或发布归档只有一个修订提交，不自动覆盖另一份操作', async () => {
  const admin = await stack.admin();
  let row = await create(admin.http);
  const writes = await Promise.all(
    ['第一份调整', '第二份调整'].map((title) =>
      admin.http.write(base + '/' + row.id, { ...input, title }, 'PATCH', {
        'Idempotency-Key': randomUUID(),
        'If-Match': announcementEtag(row.id, row.revision),
      }),
    ),
  );
  expect(writes.map((value) => value.status).sort()).toEqual([200, 412]);
  row = await create(admin.http, { ...input, title: '并发发布和归档' });
  const transitions = await Promise.all(
    ['publish', 'archive'].map((action) =>
      admin.http.write(
        base + '/' + row.id + '/' + action,
        { reason: '同一修订并发处理', confirmed: true },
        'POST',
        { 'Idempotency-Key': randomUUID(), 'If-Match': announcementEtag(row.id, row.revision) },
      ),
    ),
  );
  expect(transitions.map((value) => value.status).sort()).toEqual([200, 412]);
  const current = AdminAnnouncementResponseSchema.parse(
    await (await admin.http.raw(base + '/' + row.id)).json(),
  ).data;
  expect((await stack.browser().raw('/api/v1/announcements/' + row.id)).status).toBe(
    current.status === 'published' ? 200 : 404,
  );
  expect(current.revision).toBe(2);
});

it('公告管理拒绝越权、账号错配、绕过确认和错误修订，公开查询不接受私有状态', async () => {
  const admin = await stack.admin();
  const author = await verifiedCreator(stack);
  expect((await stack.browser().raw(base)).status).toBe(401);
  expect((await author.http.raw(base)).status).toBe(403);
  expect(
    (await author.http.write(base, input, 'POST', { 'Idempotency-Key': randomUUID() })).status,
  ).toBe(403);
  expect((await admin.http.write(base, input)).status).toBe(400);
  expect(
    (
      await admin.http.write(base, { ...input, status: 'published' }, 'POST', {
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await admin.http.write(base, input, 'POST', {
        'Idempotency-Key': randomUUID(),
        'X-Expected-Account': randomUUID(),
      })
    ).status,
  ).toBe(409);
  const row = await create(admin.http);
  expect((await author.http.raw(base + '/' + row.id + '/records')).status).toBe(403);
  expect(
    (
      await admin.http.write(
        base + '/' + row.id + '/publish',
        { reason: '绕过确认', confirmed: false },
        'POST',
        { 'Idempotency-Key': randomUUID(), 'If-Match': announcementEtag(row.id, row.revision) },
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await admin.http.write(base + '/' + row.id, { ...input, title: '错误资源的修订' }, 'PATCH', {
        'Idempotency-Key': randomUUID(),
        'If-Match': announcementEtag(randomUUID(), 1),
      })
    ).status,
  ).toBe(400);
  expect((await stack.browser().raw('/api/v1/announcements?status=draft')).status).toBe(400);
  expect((await stack.browser().raw('/api/v1/announcements?pageSize=21')).status).toBe(400);
  await state(admin.http, row, 'archive');
  expect(
    (
      await admin.http.write(
        base + '/' + row.id,
        { ...input, title: '归档后不能直接编辑' },
        'PATCH',
        { 'Idempotency-Key': randomUUID(), 'If-Match': announcementEtag(row.id, 2) },
      )
    ).status,
  ).toBe(409);
});

it('置顶和列表来自公开快照，未发布的排序调整不影响读者，搜索通配符按原文匹配', async () => {
  const admin = await stack.admin();
  let first = await create(admin.http, { ...input, title: '创作 100%_ 灵感', pinned: true });
  first = await state(admin.http, first, 'publish');
  let second = await create(admin.http, { ...input, title: '另一份公告' });
  second = await state(admin.http, second, 'publish');
  await edit(admin.http, second, { ...input, title: '私有编辑稿', pinned: true });
  const pages = await Promise.all([
    publicList('?page=1&pageSize=1'),
    publicList('?page=2&pageSize=1'),
  ]);
  expect(pages.map((page) => page.meta.total)).toEqual([2, 2]);
  expect(pages.flatMap((page) => page.data.map((item) => item.id))).toEqual([first.id, second.id]);
  expect(pages[1]?.data[0]).toMatchObject({ title: '另一份公告', pinned: false });
  const listed = await admin.http.raw(base + '?q=%25_');
  expect(
    AdminAnnouncementsResponseSchema.parse(await listed.json()).data.map((item) => item.id),
  ).toEqual([first.id]);
  const text = JSON.stringify(pages);
  for (const privateField of [
    'revision',
    'updatedBy',
    'createdBy',
    'body',
    'hasUnpublishedChanges',
  ])
    expect(text).not.toContain('"' + privateField + '"');
});

it('审核员、缺少CSRF和已撤销管理角色的会话不能维护公告', async () => {
  const admin = await stack.admin();
  const author = await verifiedCreator(stack);
  await stack.owner.pool.query("UPDATE users SET role='moderator' WHERE username=$1", [
    author.username,
  ]);
  expect((await author.http.raw(base)).status).toBe(401);
  expect(
    (
      await author.http.write('/api/v1/auth/login', {
        identifier: author.username,
        password: author.password,
      })
    ).status,
  ).toBe(200);
  expect((await author.http.raw(base)).status).toBe(403);
  expect(
    (await author.http.write(base, input, 'POST', { 'Idempotency-Key': randomUUID() })).status,
  ).toBe(403);
  expect(
    (
      await admin.http.raw(base, {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      })
    ).status,
  ).toBe(403);
  const account = AuthContextResponseSchema.parse(
    await (await admin.http.raw('/api/v1/auth/context')).json(),
  ).data.account;
  if (!account) throw new Error('缺少隔离测试管理员');
  await stack.admin();
  await stack.owner.pool.query("UPDATE users SET role='user' WHERE id=$1", [account.id]);
  expect((await admin.http.raw(base)).status).toBe(401);
  expect(
    (await admin.http.write(base, input, 'POST', { 'Idempotency-Key': randomUUID() })).status,
  ).toBe(401);
});

it('公告容量上限在事务内执行，已有编辑稿仍可维护且深分页有界', async () => {
  const admin = await stack.admin();
  const account = AuthContextResponseSchema.parse(
    await (await admin.http.raw('/api/v1/auth/context')).json(),
  ).data.account;
  if (!account) throw new Error('缺少隔离测试管理员');
  // 仅在隔离库准备容量边界，最后一次创建与维护仍走真实API
  await stack.owner.pool.query(
    "INSERT INTO announcements(title,summary,body,created_by,updated_by) SELECT '容量公告 '||n,'','隔离容量测试',$1,$1 FROM generate_series(1,2000) n",
    [account.id],
  );
  expect(
    (await admin.http.write(base, input, 'POST', { 'Idempotency-Key': randomUUID() })).status,
  ).toBe(409);
  const listed = AdminAnnouncementsResponseSchema.parse(
    await (await admin.http.raw(base + '?page=100')).json(),
  );
  expect(listed.meta.total).toBe(2000);
  expect(listed.data).toHaveLength(20);
  const item = listed.data[0];
  if (!item) throw new Error('缺少容量边界条目');
  const row = AdminAnnouncementResponseSchema.parse(
    await (await admin.http.raw(base + '/' + item.id)).json(),
  ).data;
  expect(
    (await edit(admin.http, row, { ...input, title: '容量已满仍可修改原公告' })).revision,
  ).toBe(2);
  expect((await admin.http.raw(base + '?page=101')).status).toBe(400);
});
