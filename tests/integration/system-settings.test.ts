import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  AdminUserResponseSchema,
  ErrorResponseSchema,
  PublicSystemStatusResponseSchema,
  SystemSettingsRecordsResponseSchema,
  SystemRuntimeResponseSchema,
  systemSettingsEtag,
} from '@personamarket/contracts';
import {
  assertOrdinaryWriteAllowed,
  createAdministrator,
  hashPassword,
} from '@personamarket/server';
import { users } from '@personamarket/database';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { verifiedCreator } from '../fixtures/creator.js';
import {
  readSystemSettingsHttp,
  setMaintenance,
  expectMaintenance,
} from '../fixtures/system-maintenance.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
const path = '/api/v1/admin/settings/system';
beforeEach(async () => {
  stack = await createAuthStack();
});
afterEach(async () => {
  await stack?.close();
});
async function admin() {
  const username = 'system_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const credentials = {
    username,
    email: username + '@fixture.invalid',
    password: 'System fixture administrator passphrase 2026',
  };
  await createAdministrator(stack.owner, credentials);
  const http = stack.browser();
  expect(
    (
      await http.write('/api/v1/auth/login', {
        identifier: username,
        password: credentials.password,
      })
    ).status,
  ).toBe(200);
  return { http, credentials };
}
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(code);
}
function barrier() {
  const state: { resolve?: () => void } = {};
  const promise = new Promise<void>((resolve) => {
    state.resolve = resolve;
  });
  return {
    promise,
    complete() {
      if (!state.resolve) throw new Error('正常事务同步点未初始化');
      state.resolve();
    },
  };
}

it('默认状态、私有ETag、真实API运行DTO与公共no-store白名单', async () => {
  const current = await admin(),
    result = await readSystemSettingsHttp(current.http);
  expect(result.data).toEqual({ maintenanceEnabled: false, maintenanceMessage: '' });
  const response = await stack.browser().raw('/api/v1/public/system-status');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(PublicSystemStatusResponseSchema.parse(await response.json())).toEqual({
    data: result.data,
    meta: result.meta,
  });
  const runtime = await current.http.raw(path + '/runtime');
  expect(runtime.status).toBe(200);
  const value = SystemRuntimeResponseSchema.parse(await runtime.json());
  expect(value.data.component).toBe('api');
  expect(value.data.nodeVersion).toBe(process.versions.node);
  expect(value.data.build.status).toBe('available');
  expect(value.data.build).toEqual(
    JSON.parse(
      readFileSync(new URL('../../apps/api/dist/build-info.json', import.meta.url), 'utf8'),
    ),
  );
  expect((await current.http.raw(path + '/records')).status).toBe(200);
  for (const route of [path, path + '/runtime', path + '/records'])
    await error(await stack.browser().raw(route), 401, 'UNAUTHENTICATED');
});

it('开启/关闭原子保存纯文本与历史，维护中仍可管理员恢复且关闭保留配置', async () => {
  const current = await admin(),
    text = '  **只作纯文本**\n请稍后重试  ';
  const enabled = await setMaintenance(current.http, true, text);
  const publicValue = PublicSystemStatusResponseSchema.parse(
    await (await stack.browser().raw('/api/v1/public/system-status')).json(),
  );
  expect(publicValue).toEqual({ data: enabled.result.data, meta: enabled.result.meta });
  expect((await current.http.context()).data.registrationAvailable).toBe(false);
  const closed = await setMaintenance(current.http, false, text);
  expect(closed.result.data).toEqual({ maintenanceEnabled: false, maintenanceMessage: text });
  expect((await current.http.context()).data.registrationAvailable).toBe(true);
  const records = SystemSettingsRecordsResponseSchema.parse(
    await (await current.http.raw(path + '/records')).json(),
  );
  expect(records.meta.total).toBe(2);
  expect(records.data[0]).toMatchObject({
    before: enabled.result.data,
    after: closed.result.data,
    fromRevision: enabled.result.meta.revision,
    toRevision: closed.result.meta.revision,
  });
  expect(
    (
      await stack.owner.pool.query(
        "SELECT id FROM auth_audit_events WHERE event='admin.system_updated'",
      )
    ).rowCount,
  ).toBe(2);
});

it('新高危写需要真实近期密码；读/运行信息和已成功原请求核对不追加近期验证', async () => {
  const current = await admin(),
    saved = await setMaintenance(current.http, true);
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [current.credentials.username],
  );
  for (const route of [path, path + '/records', path + '/runtime'])
    expect((await current.http.raw(route)).status).toBe(200);
  expect((await current.http.write(path, saved.input, 'PATCH', saved.headers)).status).toBe(200);
  const input = {
      ...saved.input,
      data: { ...saved.result.data, maintenanceEnabled: false },
      reason: '密码确认后显式恢复',
    },
    headers = {
      ...saved.headers,
      'If-Match': systemSettingsEtag(saved.result.meta.revision),
      'Idempotency-Key': randomUUID(),
    };
  await error(await current.http.write(path, input, 'PATCH', headers), 403, 'REAUTH_REQUIRED');
  expect(
    (
      await current.http.write('/api/v1/auth/reauthenticate', {
        currentPassword: current.credentials.password,
      })
    ).status,
  ).toBe(200);
  expect((await readSystemSettingsHttp(current.http)).meta).toEqual(saved.result.meta);
  expect((await current.http.write(path, input, 'PATCH', headers)).status).toBe(200);
});

it('已绑定MFA保持实际MFA_REQUIRED且密码不能旁路，普通读取继续', async () => {
  const current = await stack.admin(),
    saved = await setMaintenance(current.http, true);
  await stack.owner.pool.query(
    "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=(SELECT id FROM users WHERE username=$1)",
    [current.credentials.username],
  );
  expect((await current.http.raw(path)).status).toBe(200);
  await error(
    await current.http.write(
      path,
      { ...saved.input, data: { ...saved.result.data, maintenanceEnabled: false } },
      'PATCH',
      {
        ...saved.headers,
        'If-Match': systemSettingsEtag(saved.result.meta.revision),
        'Idempotency-Key': randomUUID(),
      },
    ),
    403,
    'MFA_REQUIRED',
  );
  await error(
    await current.http.write('/api/v1/auth/reauthenticate', {
      currentPassword: current.credentials.password,
    }),
    403,
    'MFA_REQUIRED',
  );
});

it('相同key并发只保存一次，CAS竞争不能覆盖，异载荷/账号核对/缺失确认仍拒绝', async () => {
  const current = await admin(),
    original = await readSystemSettingsHttp(current.http),
    account = (await current.http.context()).data.account;
  if (!account) throw new Error('缺少隔离管理员');
  const input = {
      data: { maintenanceEnabled: true, maintenanceMessage: '正常并发维护设置' },
      reason: '同键并发保存',
      confirmed: true,
    },
    headers = {
      'If-Match': systemSettingsEtag(original.meta.revision),
      'Idempotency-Key': randomUUID(),
      'X-Expected-Account': account.id,
    };
  const identical = await Promise.all([
    current.http.write(path, input, 'PATCH', headers),
    current.http.write(path, input, 'PATCH', headers),
  ]);
  expect(identical.map((r) => r.status)).toEqual([200, 200]);
  await error(
    await current.http.write(path, { ...input, reason: '同键不同理由' }, 'PATCH', headers),
    409,
    'CONFLICT',
  );
  const before = await readSystemSettingsHttp(current.http),
    casHeaders = { ...headers, 'If-Match': systemSettingsEtag(before.meta.revision) };
  const different = await Promise.all([
    current.http.write(path, { ...input, reason: '并发A' }, 'PATCH', {
      ...casHeaders,
      'Idempotency-Key': randomUUID(),
    }),
    current.http.write(path, { ...input, reason: '并发B' }, 'PATCH', {
      ...casHeaders,
      'Idempotency-Key': randomUUID(),
    }),
  ]);
  expect(different.map((r) => r.status).sort()).toEqual([200, 412]);
  const final = await readSystemSettingsHttp(current.http);
  await error(
    await current.http.write(path, input, 'PATCH', {
      'If-Match': systemSettingsEtag(final.meta.revision),
      'Idempotency-Key': randomUUID(),
      'X-Expected-Account': randomUUID(),
    }),
    409,
    'CONFLICT',
  );
  expect(
    (
      await current.http.write(path, { ...input, confirmed: false }, 'PATCH', {
        ...casHeaders,
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(400);
  await error(
    await current.http.write(path, input, 'PATCH', { 'Idempotency-Key': randomUUID() }),
    412,
    'REVISION_CONFLICT',
  );
  await error(
    await current.http.write(path, input, 'PATCH', {
      'If-Match': systemSettingsEtag(final.meta.revision),
    }),
    400,
    'INVALID_INPUT',
  );
  expect(
    SystemSettingsRecordsResponseSchema.parse(
      await (await current.http.raw(path + '/records')).json(),
    ).meta.total,
  ).toBe(2);
});

it('普通身份不能读写系统设置，正常角色API撤销管理员后旧会话立即失效', async () => {
  const first = await admin(),
    second = await admin(),
    ordinary = await verifiedCreator(stack),
    original = await readSystemSettingsHttp(first.http);
  for (const route of [path, path + '/records', path + '/runtime'])
    await error(await ordinary.http.raw(route), 403, 'FORBIDDEN');
  const target = (await first.http.context()).data.account;
  if (!target) throw new Error('缺少隔离目标管理员');
  const detail = AdminUserResponseSchema.parse(
    await (await second.http.raw('/api/v1/admin/users/' + target.id)).json(),
  ).data;
  expect(
    (
      await second.http.write(
        '/api/v1/admin/users/' + target.id + '/role',
        {
          role: 'user',
          expectedSecurityVersion: detail.securityVersion,
          reason: '正常管理撤销系统设置权限',
        },
        'PUT',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(200);
  await error(await first.http.raw(path), 401, 'UNAUTHENTICATED');
  expect(
    (
      await first.http.write('/api/v1/auth/login', {
        identifier: first.credentials.username,
        password: first.credentials.password,
      })
    ).status,
  ).toBe(200);
  await error(await first.http.raw(path), 403, 'FORBIDDEN');
  await error(
    await ordinary.http.write(
      path,
      { data: original.data, reason: '普通账号无写权限', confirmed: true },
      'PATCH',
      { 'If-Match': systemSettingsEtag(original.meta.revision), 'Idempotency-Key': randomUUID() },
    ),
    403,
    'FORBIDDEN',
  );
  expect((await readSystemSettingsHttp(second.http)).meta).toEqual(original.meta);
});

it.each(['missing', 'invalid'] as const)(
  '独立%s配置明确failclosed，同时CSRF/真实登录/密码确认仍可达',
  async (kind) => {
    const current = await admin();
    // 正常旧配置来源夹具，不停止或破坏PG/Redis/SMTP基础设施。
    if (kind === 'missing')
      await stack.owner.pool.query("DELETE FROM site_settings WHERE key='system'");
    else
      await stack.owner.pool.query("UPDATE site_settings SET value=$1 WHERE key='system'", [
        { maintenanceEnabled: 'invalid', maintenanceMessage: '' },
      ]);
    for (const route of ['/api/v1/public/system-status', path])
      await error(await current.http.raw(route), 503, 'SERVICE_UNAVAILABLE');
    const anonymous = stack.browser(),
      context = await anonymous.context();
    expect(context.data.registrationAvailable).toBe(false);
    expect(context.data.csrfToken.length).toBeGreaterThan(0);
    expect(context.data.account).toBeNull();
    expect(
      (
        await anonymous.write('/api/v1/auth/login', {
          identifier: current.credentials.username,
          password: current.credentials.password,
        })
      ).status,
    ).toBe(200);
    expect((await anonymous.context()).data.account?.role).toBe('admin');
    expect(
      (
        await anonymous.write('/api/v1/auth/reauthenticate', {
          currentPassword: current.credentials.password,
        })
      ).status,
    ).toBe(200);
    const username = 'blocked_' + randomUUID().replaceAll('-', '').slice(0, 12);
    await error(
      await stack.browser().write('/api/v1/auth/register', {
        username,
        email: username + '@fixture.invalid',
        password: 'A valid blocked registration passphrase 2026',
      }),
      503,
      'SERVICE_UNAVAILABLE',
    );
    expect(
      (await stack.owner.pool.query('SELECT id FROM users WHERE username=$1', [username])).rowCount,
    ).toBe(0);
  },
);

it('共享门禁与正常维护切换形成提交边界，后续新事务明确拒绝且无新账号', async () => {
  const current = await admin(),
    username = 'gated_' + randomUUID().replaceAll('-', '').slice(0, 12),
    passwordHash = await hashPassword('A bounded normal gate fixture passphrase 2026');
  const acquired = barrier(),
    ready = barrier();
  let committed = false;
  const writing = stack.owner.db
    .transaction(async (tx) => {
      await assertOrdinaryWriteAllowed(tx);
      acquired.complete();
      await ready.promise;
      await tx
        .insert(users)
        .values({ username, email: username + '@fixture.invalid', passwordHash });
    })
    .then(() => {
      committed = true;
    });
  try {
    await Promise.race([acquired.promise, writing]);
    const switching = setMaintenance(current.http, true).then((result) => {
      expect(committed).toBe(true);
      return result;
    });
    ready.complete();
    await Promise.all([writing, switching]);
    expect(
      (await stack.owner.pool.query('SELECT id FROM users WHERE username=$1', [username])).rowCount,
    ).toBe(1);
    await expect(
      stack.owner.db.transaction(async (tx) => {
        await assertOrdinaryWriteAllowed(tx);
        await tx.insert(users).values({
          username: username + '_late',
          email: username + '_late@fixture.invalid',
          passwordHash,
        });
      }),
    ).rejects.toMatchObject({ code: 'MAINTENANCE_MODE' });
    expect(
      (await stack.owner.pool.query('SELECT id FROM users WHERE username=$1', [username + '_late']))
        .rowCount,
    ).toBe(0);
    await expectMaintenance(
      await stack.browser().write('/api/v1/auth/register', {
        username: username + '_api',
        email: username + '_api@fixture.invalid',
        password: 'A valid maintenance registration passphrase 2026',
      }),
    );
  } finally {
    ready.complete();
    await Promise.allSettled([writing]);
  }
});
