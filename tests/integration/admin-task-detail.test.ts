import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { AdminTaskListResponseSchema } from '@personamarket/contracts';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeAll(async () => {
  stack = await createAuthStack();
});
afterAll(async () => {
  await stack?.close();
});
const path = (id: string) => '/api/v1/admin/tasks/image/' + id;
it('单任务状态只读入口拒绝匿名、用户和审核员，管理员过期MFA不阻断读取', async () => {
  const id = randomUUID();
  expect((await stack.browser().raw(path(id))).status).toBe(401);
  const user = await verifiedCreator(stack);
  expect((await user.http.raw(path(id))).status).toBe(403);
  await stack.owner.pool.query("UPDATE users SET role='moderator' WHERE username=$1", [
    user.username,
  ]);
  expect(
    (
      await user.http.write('/api/v1/auth/login', {
        identifier: user.username,
        password: user.password,
      })
    ).status,
  ).toBe(200);
  expect((await user.http.raw(path(id))).status).toBe(403);
  const admin = await stack.admin(),
    account = (await admin.http.context()).data.account;
  if (!account) throw Error('缺少隔离管理员');
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=$1 AND revoked_at IS NULL",
    [account.id],
  );
  const response = await admin.http.raw(path(id));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({
    data: null,
    meta: { queueObservation: { status: 'ready' } },
  });
});
it('按真实业务ID读取当前版本和观测范围，不依赖列表页码，不泄漏来源并处理状态变化', async () => {
  const admin = await stack.admin(),
    account = (await admin.http.context()).data.account,
    id = 'a' + randomUUID().slice(1);
  if (!account) throw Error('缺少隔离管理员');
  const privateMarker = 'PRIVATE_TASK_SOURCE_NOT_RETURNED';
  await stack.owner.pool.query(
    "INSERT INTO asset_jobs(id,owner_id,source_url,status,error_code) VALUES($1,$2,$3,'failed','IMAGE_IMPORT_FAILED')",
    [id, account.id, 'https://fixture.invalid/' + privateMarker],
  );
  const list = await admin.http.raw('/api/v1/admin/tasks?category=images');
  const listed = AdminTaskListResponseSchema.parse(await list.json()).data.find(
    (task) => task.id === id,
  );
  expect(listed).toBeDefined();
  const response = await admin.http.raw(path(id.toUpperCase()));
  expect(response.status).toBe(200);
  const raw = await response.text();
  expect(raw).not.toContain(privateMarker);
  expect(JSON.parse(raw)).toMatchObject({
    data: listed,
    meta: { queueObservation: { status: 'ready' } },
  });
  await stack.owner.pool.query(
    "UPDATE asset_jobs SET status='pending',error_code=NULL WHERE id=$1",
    [id],
  );
  const pending = await admin.http.raw(path(id));
  expect(pending.status).toBe(200);
  expect(await pending.json()).toMatchObject({ data: null });
  expect(
    (await admin.http.raw(path(id), { headers: { 'X-Expected-Account': randomUUID() } })).status,
  ).toBe(409);
});
