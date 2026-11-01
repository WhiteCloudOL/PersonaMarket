import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  OwnProfileResponseSchema,
  ProfileSubmissionResponseSchema,
  PublicCreatorResponseSchema,
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

it('个人资料真实保存、提交、审核、退回和撤回不提前替换已批准公开快照', async () => {
  const creator = await verifiedCreator(stack),
    administrator = await stack.admin(),
    other = await verifiedCreator(stack);
  const route = '/api/v1/me/profile';
  const anonymous = stack.browser();
  const publicRoute = '/api/v1/users/' + creator.username;
  const first = {
    displayName: '云间的创作者',
    bio: '第一份公开简介，保留原文\n一起分享灵感 ',
    avatarAssetId: null,
    links: [{ label: '创作笔记', url: 'https://creator.example.invalid/notes' }],
  };
  expect((await anonymous.raw(route)).status).toBe(401);
  const initialResponse = await creator.http.raw(route);
  expect(initialResponse.status).toBe(200);
  const initial = OwnProfileResponseSchema.parse(await initialResponse.json()).data;
  expect(initial.revision).toBe(0);
  expect(initial.published).toBeNull();
  const saved = await creator.http.write(route, { content: first, expectedRevision: 0 }, 'PUT');
  expect(saved.status).toBe(200);
  expect(OwnProfileResponseSchema.parse(await saved.json()).data.content).toEqual(first);
  const fallback = PublicCreatorResponseSchema.parse(
    await (await anonymous.raw(publicRoute)).json(),
  ).data;
  expect(fallback.displayName).toBe(creator.username);
  expect(fallback.bio).toBe('');
  expect(fallback.links).toEqual([]);
  expect(fallback.avatarUrl).toBeNull();
  expect(fallback.approvedRevisionId).toBeNull();

  const submissionKey = nonce();
  const command = { expectedDraftRevision: 1, confirmed: true };
  const submitted = await creator.http.write(
    route + '/submissions',
    command,
    'POST',
    submissionKey,
  );
  expect(submitted.status).toBe(200);
  const firstSubmission = ProfileSubmissionResponseSchema.parse(await submitted.json()).data;
  expect(firstSubmission.snapshot).toEqual(first);
  expect(firstSubmission.status).toBe('PENDING');
  expect(
    ProfileSubmissionResponseSchema.parse(
      await (
        await creator.http.write(route + '/submissions', command, 'POST', submissionKey)
      ).json(),
    ).data.id,
  ).toBe(firstSubmission.id);
  expect((await other.http.raw(route + '/submissions/' + firstSubmission.id)).status).toBe(404);
  expect(
    PublicCreatorResponseSchema.parse(await (await anonymous.raw(publicRoute)).json()).data,
  ).toEqual(fallback);

  expect(
    (
      await administrator.http.write(
        '/api/v1/admin/profiles/submissions/' + firstSubmission.id + '/review',
        {
          decision: 'approve',
          expectedRevision: firstSubmission.revision,
          reason: '资料真实审核通过',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  const approved = PublicCreatorResponseSchema.parse(
    await (await anonymous.raw(publicRoute)).json(),
  ).data;
  expect(approved.displayName).toBe(first.displayName);
  expect(approved.bio).toBe(first.bio);
  expect(approved.links).toEqual(first.links);
  expect(approved.approvedRevisionId).toBe(firstSubmission.id);
  for (const privateValue of [
    creator.email,
    creator.password,
    'passwordHash',
    'latestSubmission',
    'mfaEnabled',
  ])
    expect(JSON.stringify(approved)).not.toContain(privateValue);

  const second = { ...first, displayName: '尚未批准的新昵称', bio: '待审内容不得出现在公开主页' };
  expect(
    (await creator.http.write(route, { content: second, expectedRevision: 1 }, 'PUT')).status,
  ).toBe(200);
  const pendingResult = await creator.http.write(
    route + '/submissions',
    { expectedDraftRevision: 2, confirmed: true },
    'POST',
    nonce(),
  );
  expect(pendingResult.status).toBe(200);
  const pending = ProfileSubmissionResponseSchema.parse(await pendingResult.json()).data;
  expect(
    PublicCreatorResponseSchema.parse(await (await anonymous.raw(publicRoute)).json()).data,
  ).toEqual(approved);
  expect(
    (
      await administrator.http.write(
        '/api/v1/admin/profiles/submissions/' + pending.id + '/review',
        {
          decision: 'reject',
          expectedRevision: pending.revision,
          reason: '请补充公开资料来源说明',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  const rejectedOwn = OwnProfileResponseSchema.parse(
    await (await creator.http.raw(route)).json(),
  ).data;
  expect(rejectedOwn.latestSubmission?.status).toBe('REJECTED');
  expect(rejectedOwn.latestSubmission?.reason).toBe('请补充公开资料来源说明');
  expect(
    PublicCreatorResponseSchema.parse(await (await anonymous.raw(publicRoute)).json()).data,
  ).toEqual(approved);

  const resubmittedResult = await creator.http.write(
    route + '/submissions',
    { expectedDraftRevision: 2, confirmed: true },
    'POST',
    nonce(),
  );
  expect(resubmittedResult.status).toBe(200);
  const resubmitted = ProfileSubmissionResponseSchema.parse(await resubmittedResult.json()).data;
  expect(resubmitted.id).not.toBe(pending.id);
  expect(
    (
      await creator.http.write(
        route + '/submissions/' + resubmitted.id + '/withdraw',
        { expectedRevision: resubmitted.revision, confirmed: true },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(200);
  expect(
    OwnProfileResponseSchema.parse(await (await creator.http.raw(route)).json()).data
      .latestSubmission?.status,
  ).toBe('WITHDRAWN');
  expect(
    (
      await administrator.http.write(
        '/api/v1/admin/profiles/submissions/' + resubmitted.id + '/review',
        {
          decision: 'approve',
          expectedRevision: resubmitted.revision,
          reason: '撤回后不能审批',
          selfReviewConfirmed: false,
        },
        'POST',
        nonce(),
      )
    ).status,
  ).toBe(409);
  expect(
    PublicCreatorResponseSchema.parse(await (await anonymous.raw(publicRoute)).json()).data,
  ).toEqual(approved);
});
