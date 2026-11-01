import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminPersonaResponseSchema,
  AdminPersonaRecordsResponseSchema,
  SubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { completePersona, verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});

it('批量处置逐项返回真实部分失败，重试不重复写入且保持修订冲突', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const first = await completePersona(owner.http);
  const second = await completePersona(owner.http);
  async function current(id: string) {
    const response = await admin.http.raw('/api/v1/admin/personas/' + id);
    expect(response.status).toBe(200);
    return AdminPersonaResponseSchema.parse(await response.json()).data;
  }
  const a = await current(first.id);
  const b = await current(second.id);
  const missing = randomUUID();
  const command = {
    action: 'block',
    reason: '逐项核对当前作品',
    items: [
      { id: first.id, expectedRevision: a.revision, idempotencyKey: randomUUID() },
      { id: missing, expectedRevision: 1, idempotencyKey: randomUUID() },
      { id: second.id, expectedRevision: b.revision + 1, idempotencyKey: randomUUID() },
    ],
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await admin.http.write('/api/v1/admin/personas/bulk', command);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [
        { id: first.id, ok: true },
        { id: missing, ok: false, error: { code: 'NOT_FOUND' } },
        { id: second.id, ok: false, error: { code: 'REVISION_CONFLICT' } },
      ],
    });
  }
  expect(await current(first.id)).toMatchObject({
    moderationState: 'blocked',
    revision: a.revision + 1,
  });
  expect(await current(second.id)).toMatchObject({
    moderationState: 'normal',
    revision: b.revision,
  });
  expect(
    (
      await stack.owner.pool.query(
        "SELECT count(*)::int AS count FROM moderation_records WHERE persona_id=$1 AND action='persona_blocked'",
        [first.id],
      )
    ).rows[0]?.count,
  ).toBe(1);
  const changed = await admin.http.write('/api/v1/admin/personas/bulk', {
    ...command,
    action: 'restore',
  });
  expect(changed.status).toBe(200);
  expect(await changed.json()).toMatchObject({
    data: [
      { id: first.id, ok: false, error: { code: 'CONFLICT' } },
      { id: missing, ok: false, error: { code: 'NOT_FOUND' } },
      { id: second.id, ok: false, error: { code: 'REVISION_CONFLICT' } },
    ],
  });
});

it('管理记录只对白名单管理员开放，理由原样展示且不返回私有身份或请求字段', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const created = await completePersona(owner.http);
  const path = '/api/v1/admin/personas/' + created.id + '/records';
  const empty = await admin.http.raw(path);
  expect(empty.status).toBe(200);
  expect(empty.headers.get('cache-control')).toContain('no-store');
  expect(await empty.json()).toMatchObject({ data: [], meta: { total: 0, page: 1, pageSize: 20 } });
  expect((await owner.http.raw(path)).status).toBe(403);
  expect((await stack.browser().raw(path)).status).toBe(401);
  expect((await admin.http.raw(path + '?pageSize=21')).status).toBe(400);
  const current = await admin.http.raw('/api/v1/admin/personas/' + created.id);
  const row = AdminPersonaResponseSchema.parse(await current.json()).data;
  const reason = '明确的处理依据\n<script>alert(1)</script>';
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/personas/' + created.id + '/moderation',
        {
          state: 'blocked',
          expectedRevision: row.revision,
          reason,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const response = await admin.http.raw(path);
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(body).toMatchObject({
    data: [{ actor: admin.credentials.username, action: 'persona_blocked', reason }],
    meta: { total: 1 },
  });
  for (const field of ['requestId', 'email', 'password', 'securityVersion', 'snapshot', 'payload'])
    expect(JSON.stringify(body)).not.toContain('"' + field + '"');
});

it('批量操作拒绝越权、伪造当前账号、重复目标和超过上限的集合', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const created = await completePersona(owner.http);
  const item = { id: created.id, expectedRevision: 1, idempotencyKey: randomUUID() };
  const input = { action: 'block', reason: '操作范围校验', items: [item] };
  expect((await owner.http.write('/api/v1/admin/personas/bulk', input)).status).toBe(403);
  expect(
    (
      await admin.http.write('/api/v1/admin/personas/bulk', input, 'POST', {
        'X-Expected-Account': randomUUID(),
      })
    ).status,
  ).toBe(409);
  for (const items of [
    [item, { ...item, id: item.id.toUpperCase(), idempotencyKey: randomUUID() }],
    Array.from({ length: 21 }, () => ({ ...item, id: randomUUID(), idempotencyKey: randomUUID() })),
  ])
    expect(
      (await admin.http.write('/api/v1/admin/personas/bulk', { ...input, items })).status,
    ).toBe(400);
});

it('批量推荐逐项验证公开资格，重试不会重复记录已成功的作品', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const published = await completePersona(owner.http);
  const unpublished = await completePersona(owner.http);
  const submitted = await owner.http.write(
    '/api/v1/me/personas/' + published.id + '/releases',
    { version: '1.0.0', changelog: '批量推荐资格检查', expectedDraftRevision: 2, confirmed: true },
    'POST',
    { 'Idempotency-Key': randomUUID() },
  );
  expect(submitted.status).toBe(200);
  const submission = SubmissionResponseSchema.parse(await submitted.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + submission.id + '/review',
        {
          action: 'approve',
          expectedRevision: submission.revision,
          reason: '核对公开资格',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const items = [];
  for (const persona of [published, unpublished]) {
    const current = await admin.http.raw('/api/v1/admin/personas/' + persona.id);
    expect(current.status).toBe(200);
    items.push({
      id: persona.id,
      expectedRevision: AdminPersonaResponseSchema.parse(await current.json()).data.revision,
      idempotencyKey: randomUUID(),
    });
  }
  const input = {
    action: 'curate',
    official: false,
    featured: true,
    reason: '推荐真实公开作品',
    items,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await admin.http.write('/api/v1/admin/personas/bulk', input);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [
        { id: published.id, ok: true },
        { id: unpublished.id, ok: false, error: { code: 'CONFLICT' } },
      ],
    });
  }
  const records = await admin.http.raw('/api/v1/admin/personas/' + published.id + '/records');
  expect(records.status).toBe(200);
  expect(
    AdminPersonaRecordsResponseSchema.parse(await records.json()).data.filter(
      (record) => record.action === 'persona_curated',
    ),
  ).toHaveLength(1);
  expect((await stack.browser().raw('/api/v1/personas/' + unpublished.id)).status).toBe(404);
});

it('管理记录分页保持稳定顺序，翻页不重复或遗漏记录', async () => {
  const admin = await stack.admin();
  const owner = await verifiedCreator(stack);
  const created = await completePersona(owner.http);
  const path = '/api/v1/admin/personas/' + created.id;
  const current = await admin.http.raw(path);
  expect(current.status).toBe(200);
  const revision = AdminPersonaResponseSchema.parse(await current.json()).data.revision;
  for (let index = 0; index < 21; index++) {
    expect(
      (
        await admin.http.write(
          path + '/moderation',
          {
            state: index % 2 === 0 ? 'blocked' : 'normal',
            expectedRevision: revision + index,
            reason: '分页处理依据 ' + index,
          },
          'POST',
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
    ).toBe(200);
  }
  const first = await admin.http.raw(path + '/records');
  const second = await admin.http.raw(path + '/records?page=2');
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  const firstPage = AdminPersonaRecordsResponseSchema.parse(await first.json());
  const secondPage = AdminPersonaRecordsResponseSchema.parse(await second.json());
  expect(firstPage.meta).toEqual({ page: 1, pageSize: 20, total: 21 });
  expect(secondPage.meta).toEqual({ page: 2, pageSize: 20, total: 21 });
  expect(firstPage.data).toHaveLength(20);
  expect(secondPage.data).toHaveLength(1);
  const records = [...firstPage.data, ...secondPage.data];
  expect(new Set(records.map((record) => record.id)).size).toBe(21);
  expect(records.map((record) => record.reason)).toEqual(
    Array.from({ length: 21 }, (_, index) => '分页处理依据 ' + (20 - index)),
  );
});
