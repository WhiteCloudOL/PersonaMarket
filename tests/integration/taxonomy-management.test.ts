import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import {
  AuthContextResponseSchema,
  DraftResponseSchema,
  ErrorResponseSchema,
  PublicReleaseResponseSchema,
  SubmissionResponseSchema,
  TaxonomyManagementDetailResponseSchema,
  TaxonomyManagementListResponseSchema,
  TaxonomyManagementRecordsResponseSchema,
  TaxonomyResponseSchema,
  PublicFacetsResponseSchema,
  taxonomyEntryEtag,
  type TaxonomyKind,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { createDatabase } from '@personamarket/database';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const path = (kind: TaxonomyKind) =>
  '/api/v1/admin/' + (kind === 'category' ? 'categories' : 'tags');
async function createEntry(http: AuthHttp, kind: TaxonomyKind, name: string) {
  const input = { name, active: true, sortOrder: -100, reason: '整理真实的创作目录' };
  const key = randomUUID();
  const response = await http.write(path(kind), input, 'POST', { 'Idempotency-Key': key });
  expect(response.status).toBe(200);
  const body = TaxonomyManagementDetailResponseSchema.parse(await response.json());
  expect(response.headers.get('etag')).toBe(taxonomyEntryEtag(kind, body.data.id, 1));
  return { row: body.data, input, key };
}

it.each(['category', 'tag'] as const)(
  '%s真实创建、修订、归档恢复均幂等并记录白名单前后状态',
  async (kind) => {
    const admin = await stack.admin();
    const account = AuthContextResponseSchema.parse(
      await (await admin.http.raw('/api/v1/auth/context')).json(),
    ).data.account;
    if (!account) throw new Error('缺少测试管理员');
    await stack.owner.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '20 minutes',mfa_verified_at=now()-interval '20 minutes' WHERE user_id=$1",
      [account.id],
    );
    const created = await createEntry(admin.http, kind, '春日 100% 灵感');
    const endpoint = path(kind) + '/' + created.row.id;
    const replay = await admin.http.write(path(kind), created.input, 'POST', {
      'Idempotency-Key': created.key,
    });
    expect(replay.status).toBe(200);
    expect(TaxonomyManagementDetailResponseSchema.parse(await replay.json()).data.id).toBe(
      created.row.id,
    );
    expect(
      (
        await admin.http.write(path(kind), { ...created.input, name: '同键不能改名' }, 'POST', {
          'Idempotency-Key': created.key,
        })
      ).status,
    ).toBe(409);
    const listed = await admin.http.raw(path(kind) + '?q=%25');
    expect(listed.status).toBe(200);
    const list = TaxonomyManagementListResponseSchema.parse(await listed.json());
    expect(list.data.map((row) => row.id)).toEqual([created.row.id]);
    expect(listed.headers.get('cache-control')).toContain('no-store');
    const input = { ...created.input, name: '新名称<script>literal</script>', active: false };
    const key = randomUUID();
    const headers = {
      'If-Match': taxonomyEntryEtag(kind, created.row.id, 1),
      'Idempotency-Key': key,
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const updated = await admin.http.write(endpoint, input, 'PATCH', headers);
      expect(updated.status).toBe(200);
      expect(TaxonomyManagementDetailResponseSchema.parse(await updated.json()).data).toMatchObject(
        { revision: 2, name: input.name, active: false },
      );
    }
    const stale = await admin.http.write(endpoint, { ...input, active: true }, 'PATCH', {
      ...headers,
      'Idempotency-Key': randomUUID(),
    });
    expect(stale.status).toBe(412);
    expect(ErrorResponseSchema.parse(await stale.json()).error.code).toBe('REVISION_CONFLICT');
    const archived = await admin.http.write(endpoint, { reason: '归档未被引用的条目' }, 'DELETE', {
      'If-Match': taxonomyEntryEtag(kind, created.row.id, 2),
      'Idempotency-Key': randomUUID(),
    });
    expect(archived.status).toBe(200);
    const archivedRow = TaxonomyManagementDetailResponseSchema.parse(await archived.json()).data;
    expect(archivedRow.archivedAt).not.toBeNull();
    expect(archivedRow).toMatchObject({ revision: 3, active: false });
    const restored = await admin.http.write(
      endpoint + '/restore',
      { reason: '恢复条目后再明确启用' },
      'POST',
      { 'If-Match': taxonomyEntryEtag(kind, created.row.id, 3), 'Idempotency-Key': randomUUID() },
    );
    expect(restored.status).toBe(200);
    expect(TaxonomyManagementDetailResponseSchema.parse(await restored.json()).data).toMatchObject({
      revision: 4,
      active: false,
      archivedAt: null,
    });
    const enabled = await admin.http.write(endpoint, { ...input, active: true }, 'PATCH', {
      'If-Match': taxonomyEntryEtag(kind, created.row.id, 4),
      'Idempotency-Key': randomUUID(),
    });
    expect(enabled.status).toBe(200);
    const publicOptions = TaxonomyResponseSchema.parse(
      await (await admin.http.raw('/api/v1/site/taxonomy')).json(),
    ).data;
    expect((kind === 'category' ? publicOptions.categories : publicOptions.tags)[0]).toEqual({
      id: created.row.id,
      name: input.name,
    });
    const facets = PublicFacetsResponseSchema.parse(
      await (await admin.http.raw('/api/v1/site/persona-filters')).json(),
    ).data;
    expect((kind === 'category' ? facets.categories : facets.tags)[0]).toEqual({
      id: created.row.id,
      name: input.name,
      count: 0,
    });
    const records = await admin.http.raw(endpoint + '/records');
    expect(records.status).toBe(200);
    const audit = TaxonomyManagementRecordsResponseSchema.parse(await records.json());
    expect(audit.data.map((record) => record.action)).toEqual([
      'updated',
      'restored',
      'archived',
      'updated',
      'created',
    ]);
    expect(audit.meta.total).toBe(5);
    expect(audit.data[0]?.after).toMatchObject({ revision: 5, active: true, name: input.name });
    for (const privateField of ['requestId', 'email', 'password', 'securityVersion'])
      expect(JSON.stringify(audit)).not.toContain('"' + privateField + '"');
    const recordId = audit.data[0]?.id;
    if (!recordId) throw new Error('缺少真实管理记录');
    await expect(
      stack.owner.pool.query('UPDATE taxonomy_management_records SET reason=$2 WHERE id=$1', [
        recordId,
        '不可修改历史依据',
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    const application = createDatabase(stack.env.DATABASE_URL);
    try {
      await expect(
        application.pool.query('DELETE FROM taxonomy_management_records WHERE id=$1', [recordId]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await application.close();
    }
  },
);

it('分类标签修改不会重写冻结资料，引用归档受阻而停用不下架既有作品', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const category = await createEntry(admin.http, 'category', '原始分类名称');
  const tag = await createEntry(admin.http, 'tag', '原始标签名称');
  const persona = await completePersona(owner.http);
  const draft = { ...persona.draft, categoryId: category.row.id, tagIds: [tag.row.id] };
  expect(
    (
      await owner.http.write('/api/v1/me/personas/' + persona.id + '/draft', draft, 'PUT', {
        'If-Match': '"draft-2"',
      })
    ).status,
  ).toBe(200);
  for (const entry of [category, tag]) {
    const endpoint = path(entry.row.kind) + '/' + entry.row.id;
    const detail = await admin.http.raw(endpoint);
    expect(detail.status).toBe(200);
    expect(TaxonomyManagementDetailResponseSchema.parse(await detail.json()).usage).toEqual({
      drafts: 1,
      submissions: 0,
    });
    expect(
      (
        await admin.http.write(endpoint, { reason: '不能归档草稿仍使用的目录' }, 'DELETE', {
          'If-Match': taxonomyEntryEtag(entry.row.kind, entry.row.id, 1),
          'Idempotency-Key': randomUUID(),
        })
      ).status,
    ).toBe(409);
  }
  const submitted = await owner.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    { version: '1.0.0', changelog: '冻结目录名称', expectedDraftRevision: 3, confirmed: true },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(submitted.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await submitted.json()).data;
  expect(submission.publication.category.name).toBe(category.input.name);
  expect(submission.publication.tags.map((row) => row.name)).toEqual([tag.input.name]);
  for (const entry of [category, tag]) {
    const updated = await admin.http.write(
      path(entry.row.kind) + '/' + entry.row.id,
      { ...entry.input, name: entry.input.name + '已调整', active: false },
      'PATCH',
      {
        'If-Match': taxonomyEntryEtag(entry.row.kind, entry.row.id, 1),
        'Idempotency-Key': randomUUID(),
      },
    );
    expect(updated.status).toBe(200);
  }
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: submission.revision,
          reason: '审核送审时有效的冻结内容',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const publicResponse = await stack.browser().raw('/api/v1/personas/' + persona.id);
  expect(publicResponse.status).toBe(200);
  const published = PublicReleaseResponseSchema.parse(await publicResponse.json()).data;
  expect(published.publication).toEqual(submission.publication);
  expect(published.snapshot).toEqual(submission.snapshot);
  const next = await owner.http.write(
    '/api/v1/me/personas/' + persona.id + '/releases',
    {
      version: '1.1.0',
      changelog: '停用后必须重新选择有效目录',
      expectedDraftRevision: 3,
      confirmed: true,
    },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(next.status).toBe(422);
  expect(ErrorResponseSchema.parse(await next.json()).error.code).toBe('VALIDATION_FAILED');
  const current = DraftResponseSchema.parse(
    await (await owner.http.raw('/api/v1/me/personas/' + persona.id + '/draft')).json(),
  );
  expect(
    (
      await owner.http.write(
        '/api/v1/me/personas/' + persona.id + '/draft',
        { ...current.data.draft, categoryId: persona.draft.categoryId, tagIds: [] },
        'PUT',
        { 'If-Match': '"draft-' + current.meta.revision + '"' },
      )
    ).status,
  ).toBe(200);
  for (const entry of [category, tag]) {
    const endpoint = path(entry.row.kind) + '/' + entry.row.id;
    const detail = TaxonomyManagementDetailResponseSchema.parse(
      await (await admin.http.raw(endpoint)).json(),
    );
    expect(detail.usage).toEqual({ drafts: 0, submissions: 1 });
    expect(
      (
        await admin.http.write(endpoint, { reason: '历史版本的引用仍须保留' }, 'DELETE', {
          'If-Match': taxonomyEntryEtag(entry.row.kind, entry.row.id, 2),
          'Idempotency-Key': randomUUID(),
        })
      ).status,
    ).toBe(409);
  }
});

it('名称唯一约束处理真实并发，归档名称保留且不能通过新建绕过', async () => {
  const admin = await stack.admin();
  const values = ['Case-sensitive-source', 'case-sensitive-source'];
  const responses = await Promise.all(
    values.map((name) =>
      admin.http.write(
        path('category'),
        { name, active: true, sortOrder: 0, reason: '并发创建同一名称' },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      ),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  const accepted = responses.find((response) => response.status === 200);
  if (!accepted) throw new Error('并发创建没有成功项');
  const row = TaxonomyManagementDetailResponseSchema.parse(await accepted.json()).data;
  expect(
    (
      await admin.http.write(
        path('category') + '/' + row.id,
        { reason: '归档保留唯一名称' },
        'DELETE',
        { 'If-Match': taxonomyEntryEtag('category', row.id, 1), 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await admin.http.write(
        path('category'),
        { name: row.name.toUpperCase(), active: true, sortOrder: 0, reason: '应恢复已有条目' },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(409);
  const archived = await admin.http.raw(path('category') + '?state=archived&q=' + row.id);
  expect(TaxonomyManagementListResponseSchema.parse(await archived.json()).data).toHaveLength(1);
});

it('目录管理拒绝越权、账号错配、非法写入与不对应的修订标识', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const input = { name: '目录权限', active: true, sortOrder: 0, reason: '不能绕过权限' };
  expect((await stack.browser().raw(path('tag'))).status).toBe(401);
  expect((await owner.http.raw(path('category'))).status).toBe(403);
  expect(
    (await owner.http.write(path('category'), input, 'POST', { 'Idempotency-Key': randomUUID() }))
      .status,
  ).toBe(403);
  expect((await admin.http.write(path('category'), input)).status).toBe(400);
  expect(
    (
      await admin.http.write(path('category'), { ...input, role: 'admin' }, 'POST', {
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await admin.http.write(path('category'), input, 'POST', {
        'X-Expected-Account': randomUUID(),
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(409);
  const created = await createEntry(admin.http, 'category', '明确修订范围');
  expect(
    (
      await admin.http.write(
        path('category') + '/' + created.row.id,
        { ...input, name: '不能换用标签的修订' },
        'PATCH',
        {
          'If-Match': taxonomyEntryEtag('tag', created.row.id, 1),
          'Idempotency-Key': randomUUID(),
        },
      )
    ).status,
  ).toBe(400);
  expect((await owner.http.raw(path('category') + '/' + created.row.id + '/records')).status).toBe(
    403,
  );
  expect((await admin.http.raw(path('category') + '?pageSize=21')).status).toBe(400);
});

it('两个管理员请求使用同一修订时仅一次更新成功，不覆盖另一份操作', async () => {
  const admin = await stack.admin();
  const created = await createEntry(admin.http, 'tag', '并发修订核对');
  const endpoint = path('tag') + '/' + created.row.id;
  const responses = await Promise.all(
    ['第一次调整', '第二次调整'].map((name) =>
      admin.http.write(endpoint, { ...created.input, name }, 'PATCH', {
        'If-Match': taxonomyEntryEtag('tag', created.row.id, 1),
        'Idempotency-Key': randomUUID(),
      }),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
  const detail = TaxonomyManagementDetailResponseSchema.parse(
    await (await admin.http.raw(endpoint)).json(),
  );
  expect(detail.data.revision).toBe(2);
  expect(['第一次调整', '第二次调整']).toContain(detail.data.name);
  const records = TaxonomyManagementRecordsResponseSchema.parse(
    await (await admin.http.raw(endpoint + '/records')).json(),
  );
  expect(records.data.map((record) => record.action)).toEqual(['updated', 'created']);
});

it('停用与送审并发时只接受已核对的有效目录，历史送审记录可继续审核', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const category = await createEntry(admin.http, 'category', '送审时有效的分类');
  const persona = await completePersona(owner.http);
  expect(
    (
      await owner.http.write(
        '/api/v1/me/personas/' + persona.id + '/draft',
        { ...persona.draft, categoryId: category.row.id },
        'PUT',
        { 'If-Match': '"draft-2"' },
      )
    ).status,
  ).toBe(200);
  const [submitted, disabled] = await Promise.all([
    owner.http.write(
      '/api/v1/me/personas/' + persona.id + '/releases',
      { version: '1.0.0', changelog: '并发目录检查', expectedDraftRevision: 3, confirmed: true },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    ),
    admin.http.write(
      path('category') + '/' + category.row.id,
      { ...category.input, active: false },
      'PATCH',
      {
        'If-Match': taxonomyEntryEtag('category', category.row.id, 1),
        'Idempotency-Key': randomUUID(),
      },
    ),
  ]);
  expect(disabled.status).toBe(200);
  expect([200, 422]).toContain(submitted.status);
  if (submitted.status === 200) {
    const submission = SubmissionResponseSchema.parse(await submitted.json()).data;
    expect(submission.publication.category).toEqual({
      id: category.row.id,
      name: category.input.name,
    });
    expect(
      (
        await admin.http.write(
          '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
          {
            action: 'approve',
            expectedRevision: submission.revision,
            reason: '按送审时冻结的有效目录审核',
            selfReviewConfirmed: false,
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(200);
    expect((await stack.browser().raw('/api/v1/personas/' + persona.id)).status).toBe(200);
  } else {
    expect(ErrorResponseSchema.parse(await submitted.json()).error.code).toBe('VALIDATION_FAILED');
    expect(
      (
        await stack.owner.pool.query('SELECT id FROM release_submissions WHERE persona_id=$1', [
          persona.id,
        ])
      ).rowCount,
    ).toBe(0);
  }
});

it('启用和总量上限由事务执行，关闭旧条目后仍可维护现有目录', async () => {
  const admin = await stack.admin();
  // 仅隔离测试库批量准备边界数据，最后一个位置及越界写入均经过真实API和原限流
  await stack.owner.pool.query(
    "INSERT INTO tags(name,active) SELECT 'active-boundary-'||n,true FROM generate_series(1,GREATEST(0,99-(SELECT count(*)::int FROM tags WHERE active)))n",
  );
  const created = await createEntry(admin.http, 'tag', '第100个启用条目');
  const input = { name: '超过启用上限', active: true, sortOrder: 0, reason: '按实际启用数量检查' };
  expect(
    (await admin.http.write(path('tag'), input, 'POST', { 'Idempotency-Key': randomUUID() }))
      .status,
  ).toBe(409);
  expect(
    (
      await admin.http.write(
        path('tag') + '/' + created.row.id,
        { ...created.input, active: false },
        'PATCH',
        {
          'If-Match': taxonomyEntryEtag('tag', created.row.id, 1),
          'Idempotency-Key': randomUUID(),
        },
      )
    ).status,
  ).toBe(200);
  expect(
    (await admin.http.write(path('tag'), input, 'POST', { 'Idempotency-Key': randomUUID() }))
      .status,
  ).toBe(200);
  await stack.owner.pool.query(
    "INSERT INTO tags(name,active) SELECT 'total-boundary-'||n,false FROM generate_series(1,GREATEST(0,1000-(SELECT count(*)::int FROM tags)))n",
  );
  expect(
    (
      await admin.http.write(
        path('tag'),
        { ...input, name: '不能超过目录总量', active: false },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(409);
  const last = await admin.http.raw(path('tag') + '?page=50');
  expect(last.status).toBe(200);
  const list = TaxonomyManagementListResponseSchema.parse(await last.json());
  expect(list.meta.total).toBe(1000);
  expect(list.data).toHaveLength(20);
});
