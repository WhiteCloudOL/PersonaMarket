import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  ProfileRecordsResponseSchema,
  ProfileSubmissionResponseSchema,
} from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
const nonce = () => ({ 'Idempotency-Key': randomUUID() });

it('资料送审和处置记录真实分页，只向本人及实际审核角色开放且不泄漏账号秘密', async () => {
  const creator = await verifiedCreator(stack),
    anonymous = stack.browser(),
    endpoint = '/api/v1/me/profile/records';
  const initial = await creator.http.raw(endpoint);
  expect(initial.status).toBe(200);
  expect(ProfileRecordsResponseSchema.parse(await initial.json()).meta.total).toBe(0);
  const other = await verifiedCreator(stack),
    admin = await stack.admin();
  const account = (await creator.http.context()).data.account;
  if (!account) throw new Error('Missing controlled creator');
  expect(
    (
      await creator.http.write(
        '/api/v1/me/profile',
        {
          content: { displayName: '记录作者', bio: '本人资料', avatarAssetId: null, links: [] },
          expectedRevision: 0,
        },
        'PUT',
      )
    ).status,
  ).toBe(200);
  const submitted = await creator.http.write(
    '/api/v1/me/profile/submissions',
    { expectedDraftRevision: 1, confirmed: true },
    'POST',
    nonce(),
  );
  expect(submitted.status).toBe(200);
  const submission = ProfileSubmissionResponseSchema.parse(await submitted.json()).data;
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/profiles/submissions/' + submission.id + '/review',
        {
          decision: 'approve',
          expectedRevision: 1,
          reason: '资料审核说明',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await admin.http.write(
        '/api/v1/admin/profiles/' + account.id + '/visibility',
        {
          hidden: true,
          expectedRevision: 2,
          reason: '资料隐藏说明向本人保留',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  const own = ProfileRecordsResponseSchema.parse(await (await creator.http.raw(endpoint)).json());
  expect(own.meta.total).toBe(3);
  expect(own.data.map((row) => row.action)).toEqual(['hide', 'approve', 'submit']);
  expect(own.data[0]?.reason).toBe('资料隐藏说明向本人保留');
  for (const value of [
    creator.email,
    creator.password,
    admin.credentials.email,
    admin.credentials.password,
    'encryptedSecret',
  ])
    expect(JSON.stringify(own)).not.toContain(value);
  const pages = [];
  for (const page of [1, 2, 3])
    pages.push(
      ...ProfileRecordsResponseSchema.parse(
        await (await creator.http.raw(endpoint + '?pageSize=1&page=' + page)).json(),
      ).data.map((row) => row.id),
    );
  expect(new Set(pages).size).toBe(3);
  expect(
    ProfileRecordsResponseSchema.parse(await (await other.http.raw(endpoint)).json()).data,
  ).toEqual([]);
  const adminEndpoint = '/api/v1/admin/profiles/' + account.id + '/records';
  expect((await anonymous.raw(endpoint)).status).toBe(401);
  expect((await anonymous.raw(adminEndpoint)).status).toBe(401);
  expect((await other.http.raw(adminEndpoint)).status).toBe(403);
  expect(
    ProfileRecordsResponseSchema.parse(await (await admin.http.raw(adminEndpoint)).json()).data,
  ).toEqual(own.data);
  expect((await admin.http.raw('/api/v1/admin/profiles/' + randomUUID() + '/records')).status).toBe(
    404,
  );
  expect((await creator.http.raw(endpoint + '?userId=' + randomUUID())).status).toBe(400);
});
