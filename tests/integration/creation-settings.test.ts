import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import {
  CreationSettingsResponseSchema,
  SubmissionResponseSchema,
  PublicReleaseResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator, completePersona } from '../fixtures/creator.js';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});
it('管理员设置乐观锁、直接 API 开关/平台/配额，降低上限不截断历史或草稿', async () => {
  const author = await verifiedCreator(stack);
  const admin = await stack.admin();
  const persona = await completePersona(author.http);
  const path = '/api/v1/me/personas/' + persona.id;
  const create = (version: string) =>
    author.http.write(
      path + '/releases',
      { version, expectedDraftRevision: 2, changelog: '设置验收', confirmed: true },
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
  const first = SubmissionResponseSchema.parse(await (await create('1.0.0')).json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/moderation/submissions/' + first.id + '/review',
        {
          action: 'approve',
          expectedRevision: 1,
          reason: '发布历史内容',
          selfReviewConfirmed: false,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  const settingsPath = '/api/v1/admin/settings/creation';
  expect((await author.http.raw(settingsPath)).status).toBe(403);
  let settings = CreationSettingsResponseSchema.parse(
    await (await admin.http.raw(settingsPath)).json(),
  );
  const previous = settings;
  const closed = {
    ...settings.data,
    submissions: { ...settings.data.submissions, enabled: false },
  };
  const closedResult = await admin.http.write(
    settingsPath,
    { data: closed, expected: settings.meta },
    'PATCH',
  );
  expect(closedResult.status).toBe(200);
  settings = CreationSettingsResponseSchema.parse(await closedResult.json());
  expect(
    (
      await admin.http.write(
        settingsPath,
        { data: previous.data, expected: previous.meta },
        'PATCH',
      )
    ).status,
  ).toBe(412);
  expect((await create('1.1.0')).status).toBe(403);
  expect(
    (await author.http.write('/api/v1/me/personas', { platform: 'astrbot', title: '关闭时创建' }))
      .status,
  ).toBe(403);
  expect(
    (await author.http.write(path + '/draft', persona.draft, 'PUT', { 'If-Match': '"draft-2"' }))
      .status,
  ).toBe(200);
  const lower = {
    ...settings.data,
    submissions: { ...settings.data.submissions, enabled: true },
    contentLimits: { ...settings.data.contentLimits, maibotField: 1 },
  };
  settings = CreationSettingsResponseSchema.parse(
    await (
      await admin.http.write(settingsPath, { data: lower, expected: settings.meta }, 'PATCH')
    ).json(),
  );
  expect(
    (
      await author.http.write(
        path + '/releases',
        { version: '1.1.0', expectedDraftRevision: 3, changelog: '超出新上限', confirmed: true },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(422);
  expect(
    PublicReleaseResponseSchema.parse(
      await (await stack.browser().raw('/api/v1/personas/' + persona.id)).json(),
    ).data.snapshot.content,
  ).toEqual(persona.draft.content);
  const quota = {
    ...settings.data,
    contentLimits: previous.data.contentLimits,
    submissions: { enabled: true, platforms: ['maibot'], dailyQuota: 1 },
  };
  settings = CreationSettingsResponseSchema.parse(
    await (
      await admin.http.write(settingsPath, { data: quota, expected: settings.meta }, 'PATCH')
    ).json(),
  );
  expect(settings.data.submissions.dailyQuota).toBe(1);
  expect(settings.data.submissions.platforms).toEqual(['maibot']);
  expect(
    (
      await author.http.write('/api/v1/me/personas', {
        platform: 'astrbot',
        title: '平台关闭时创建',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await author.http.write(
        path + '/releases',
        { version: '1.1.0', expectedDraftRevision: 3, changelog: '配额已用尽', confirmed: true },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(429);
  expect((await stack.browser().raw('/api/v1/personas/' + persona.id)).status).toBe(200);
});
