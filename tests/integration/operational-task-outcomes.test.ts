import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  createAdministrator,
  cleanupStorageEvent,
  LocalStorage,
  contentHash,
  enqueueMail,
  readMailContext,
} from '@personamarket/server';
import { seedLegacyUnverified } from '../fixtures/legacy-account.js';
import { createAuthStack } from '../fixtures/auth-stack.js';
import { mailCode, mailText } from '../fixtures/mailpit.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
beforeEach(async () => {
  stack = await createAuthStack({ isolatedStorage: true });
  await stack.worker.pause();
});
afterEach(async () => {
  await stack?.close();
});
async function event() {
  const id = randomUUID(),
    key = randomBytes(16).toString('hex') + '.webp';
  await stack.owner.pool.query(
    "INSERT INTO outbox_events(id,topic,payload) VALUES($1,'storage.cleanup',$2)",
    [id, { schemaVersion: 1, storageKey: key }],
  );
  return { id, key, storage: new LocalStorage(stack.env.STORAGE_ROOT) };
}
async function admin() {
  const username = 'outcome_' + randomBytes(5).toString('hex'),
    password = 'Fixture secure password 2026';
  await createAdministrator(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password,
  });
  const http = stack.browser();
  expect((await http.write('/api/v1/auth/login', { identifier: username, password })).status).toBe(
    200,
  );
  return http;
}
it('真实本地删除与重复消费保留deleted，缺失另记missing，不把消费成功猜成删除', async () => {
  const first = await event();
  await first.storage.put(first.key, new Uint8Array([1, 2, 3]));
  expect(
    await cleanupStorageEvent(
      stack.owner,
      first.storage,
      { eventId: first.id, storageKey: first.key, schemaVersion: 1 },
      true,
    ),
  ).toBe('deleted');
  expect(
    await cleanupStorageEvent(
      stack.owner,
      first.storage,
      { eventId: first.id, storageKey: first.key, schemaVersion: 1 },
      true,
    ),
  ).toBe('deleted');
  const second = await event();
  expect(
    await cleanupStorageEvent(
      stack.owner,
      second.storage,
      { eventId: second.id, storageKey: second.key, schemaVersion: 1 },
      true,
    ),
  ).toBe('missing');
  expect(
    (
      await stack.owner.pool.query('SELECT outcome FROM storage_cleanup_runs ORDER BY event_id')
    ).rows
      .map((r) => r.outcome)
      .sort(),
  ).toEqual(['deleted', 'missing']);
});
it('当前素材引用始终受保护，真实文件保持可读', async () => {
  const item = await event();
  await admin();
  const user = (await stack.owner.pool.query('SELECT id FROM users LIMIT 1')).rows[0];
  await item.storage.put(item.key, new Uint8Array([4, 5, 6]));
  await stack.owner.pool.query(
    "INSERT INTO assets(owner_id,purpose,storage_key,mime,bytes,width,height,sha256) VALUES($1,'content',$2,'image/webp',3,1,1,$3)",
    [user.id, item.key, 'a'.repeat(64)],
  );
  expect(
    await cleanupStorageEvent(
      stack.owner,
      item.storage,
      { eventId: item.id, storageKey: item.key, schemaVersion: 1 },
      true,
    ),
  ).toBe('protected');
  expect([...(await item.storage.read(item.key))]).toEqual([4, 5, 6]);
});
it('普通Unicode短原因在HTTP层拒绝而非数据库500，五字符原因可真实受理', async () => {
  const item = await event(),
    http = await admin();
  await stack.owner.pool.query(
    "UPDATE outbox_events SET attempts=5,last_error_code='DELIVERY_FAILED' WHERE id=$1",
    [item.id],
  );
  const path = '/api/v1/admin/operations/storage/' + item.id;
  const version = (await (await http.raw(path)).json()).data.version;
  const body = { action: 'retry', expectedVersion: version, reason: '😀😀😀', confirmed: true };
  expect((await http.write(path, body, 'POST', { 'Idempotency-Key': randomUUID() })).status).toBe(
    400,
  );
  expect(
    (
      await stack.owner.pool.query(
        'SELECT count(*)::int AS n FROM admin_task_retries WHERE task_id=$1',
        [item.id],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await http.write(path, { ...body, reason: '😀😀😀😀😀' }, 'POST', {
        'Idempotency-Key': randomUUID(),
      })
    ).status,
  ).toBe(200);
});
it('新验证邮件绑定真实账号/令牌；替代、消费、过期及地址变化均可核对，不猜旧密文', async () => {
  const http = stack.browser(),
    username = 'context_' + randomBytes(5).toString('hex');
  const email = username + '@fixture.invalid';
  await seedLegacyUnverified(stack.owner, {
    username,
    email,
    password: 'Fixture secure password 2026',
  });
  expect((await http.write('/api/v1/auth/resend-verification', { email })).status).toBe(200);
  const row = (
    await stack.owner.pool.query<{ event_id: string; token_id: string; user_id: string }>(
      "SELECT event_id,token_id,user_id FROM mail_task_contexts WHERE purpose='email_verify'",
    )
  ).rows[0];
  expect(row).toBeDefined();
  if (!row) throw Error('缺少新邮件业务关联');
  expect((await readMailContext(stack.owner, row.event_id))?.state).toBe('valid');
  const watcher = await admin(),
    operationPath = '/api/v1/admin/operations/mail/' + row.event_id;
  const originalVersion = (await (await watcher.raw(operationPath)).json()).data.version;
  await stack.owner.pool.query('UPDATE auth_tokens SET consumed_at=clock_timestamp() WHERE id=$1', [
    row.token_id,
  ]);
  expect((await readMailContext(stack.owner, row.event_id))?.state).toBe('token_consumed');
  expect((await (await watcher.raw(operationPath)).json()).data.version).not.toBe(originalVersion);
  expect(
    (
      await watcher.write(
        operationPath,
        {
          action: 'acknowledge',
          expectedVersion: originalVersion,
          reason: '使用旧上下文版本应明确拒绝',
          confirmed: true,
        },
        'POST',
        { 'Idempotency-Key': randomUUID() },
      )
    ).status,
  ).toBe(412);
  const id = randomUUID();
  await stack.owner.pool.query(
    "INSERT INTO auth_tokens(id,user_id,purpose,token_hash,created_at,expires_at) VALUES($1,$2,'password_reset',$3,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour')",
    [id, row.user_id, randomBytes(32).toString('hex')],
  );
  const expired = await stack.owner.db.transaction((tx) =>
    enqueueMail(
      tx,
      stack.env.APP_ENCRYPTION_KEY,
      { to: username + '@fixture.invalid', subject: '受控过期样本', text: '无令牌正文的隔离样本' },
      { purpose: 'password_reset', userId: row.user_id, tokenId: id },
    ),
  );
  expect((await readMailContext(stack.owner, expired))?.state).toBe('token_expired');
  await stack.owner.pool.query('UPDATE users SET email=$2 WHERE id=$1', [
    row.user_id,
    username + '_new@fixture.invalid',
  ]);
  const notice = await stack.owner.db.transaction((tx) =>
    enqueueMail(
      tx,
      stack.env.APP_ENCRYPTION_KEY,
      { to: username + '@fixture.invalid', subject: '受控旧邮箱', text: '无秘密' },
      { purpose: 'security_notice', userId: row.user_id },
    ),
  );
  expect((await readMailContext(stack.owner, notice))?.state).toBe('recipient_changed');
  await stack.worker.resume();
  await stack.tick();
  await expect
    .poll(
      async () =>
        (
          await stack.owner.pool.query('SELECT status FROM mail_deliveries WHERE event_id=$1', [
            expired,
          ])
        ).rows[0]?.status,
    )
    .toBe('failed');
  expect(
    (
      await stack.owner.pool.query(
        "SELECT 1 FROM processed_events WHERE consumer='auth-email' AND event_id=$1",
        [expired],
      )
    ).rowCount,
  ).toBe(0);
});
it('旧消费记录不补造删除结果；显式重查按原请求幂等且真实Worker记录missing', async () => {
  const item = await event(),
    http = await admin();
  await stack.owner.pool.query(
    "INSERT INTO processed_events(consumer,event_id) VALUES('storage-cleanup',$1)",
    [item.id],
  );
  const path = '/api/v1/admin/operations/storage/' + item.id;
  const detail = await (await http.raw(path)).json();
  expect(detail.data.status).toBe('unrecorded');
  expect(detail.data.canRetry).toBe(true);
  const body = {
      action: 'retry',
      expectedVersion: detail.data.version,
      reason: '核对旧清理记录的真实结果',
      confirmed: true,
    },
    key = randomUUID();
  const response = await http.write(path, body, 'POST', { 'Idempotency-Key': key });
  expect(response.status).toBe(200);
  const accepted = await response.json();
  expect((await http.write(path, body, 'POST', { 'Idempotency-Key': key })).status).toBe(200);
  const hash = contentHash({ kind: 'storage', id: item.id, ...body });
  const receipt = await http.raw(path + '/receipt', {
    headers: { 'Idempotency-Key': key, 'X-Retry-Request-Hash': hash },
  });
  expect(receipt.status).toBe(200);
  expect((await receipt.json()).data.recorded).toBe(true);
  await stack.worker.resume();
  await stack.tick();
  await expect.poll(async () => (await (await http.raw(path)).json()).data.status).toBe('missing');
  expect(accepted.data.action).toBe('retry');
  expect(
    (
      await stack.owner.pool.query(
        "SELECT count(*)::int AS n FROM admin_task_retries WHERE source='queue' AND task_id=$1",
        [item.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it('两个管理员并发重查同一旧事件只创建一个人工轮次，陈旧版本拒绝', async () => {
  const item = await event(),
    http = await admin();
  await stack.owner.pool.query(
    "UPDATE outbox_events SET attempts=5,last_error_code='DELIVERY_FAILED' WHERE id=$1",
    [item.id],
  );
  const path = '/api/v1/admin/operations/storage/' + item.id;
  const detail = await (await http.raw(path)).json();
  const body = {
    action: 'retry',
    expectedVersion: detail.data.version,
    reason: '并发核对同一个隔离清理任务',
    confirmed: true,
  };
  const second = await admin();
  const response = await Promise.all(
    [http, second].map((actor) =>
      actor.write(path, body, 'POST', { 'Idempotency-Key': randomUUID() }),
    ),
  );
  expect(response.map((r) => r.status).sort()).toEqual([200, 412]);
  expect(
    (
      await stack.owner.pool.query(
        "SELECT count(*)::int AS n FROM admin_task_retries WHERE source='queue' AND task_id=$1",
        [item.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it.each([1, 3])('稳定清理身份保留%s轮人工记录，冷却或上限不阻断只读原请求核对', async (rounds) => {
  const item = await event(),
    http = await admin(),
    account = (await http.context()).data.account;
  if (!account) throw Error('缺少实际隔离管理员');
  // 合法终态样本，不制造文件系统或基础设施错误。
  for (let n = 0; n <= rounds; n++) {
    const eventId = n === 0 ? item.id : randomUUID();
    if (n > 0)
      await stack.owner.pool.query(
        "INSERT INTO outbox_events(id,topic,payload,delivered_at) VALUES($1,'storage.cleanup',$2,clock_timestamp())",
        [eventId, { schemaVersion: 1, storageKey: item.key }],
      );
    await stack.owner.pool.query(
      "INSERT INTO storage_cleanup_runs(event_id,request_id,storage_key,manual_round,outcome,execution_attempts,error_code,checked_at) VALUES($1,$2,$3,$4,'failed',5,'STORAGE_CLEANUP_FAILED',clock_timestamp())",
      [eventId, item.id, item.key, n],
    );
    if (n > 0)
      await stack.owner.pool.query(
        "INSERT INTO admin_task_retries(source,task_id,event_id,previous_event_id,actor_id,attempt,expected_version,reason) VALUES('queue',$1,$2,$3,$4,$5,$6,'受控隔离人工历史样本')",
        [item.id, eventId, item.id, account.id, n, contentHash({ sample: n })],
      );
  }
  const path = '/api/v1/admin/operations/storage/' + item.id;
  const detail = await (await http.raw(path)).json();
  expect(detail.data.canRetry).toBe(false);
  expect(detail.data.manualAttempts).toBe(rounds);
  expect(detail.data.blockedReason).toContain(rounds === 3 ? '三轮' : '冷却');
  const body = {
    action: 'retry',
    expectedVersion: detail.data.version,
    reason: '核对受控隔离历史的边界',
    confirmed: true,
  };
  expect((await http.write(path, body, 'POST', { 'Idempotency-Key': randomUUID() })).status).toBe(
    409,
  );
  const receipt = await http.raw(path + '/receipt', {
    headers: {
      'Idempotency-Key': randomUUID(),
      'X-Retry-Request-Hash': contentHash({ kind: 'storage', id: item.id, ...body }),
    },
  });
  expect(receipt.status).toBe(200);
  expect((await receipt.json()).data.recorded).toBe(false);
});
it('邮件unknown可追加核对记录，绝不改写SMTP结果或产生重发；普通账号无管理读取权限', async () => {
  const http = await admin(),
    id = randomUUID();
  await stack.owner.pool.query(
    "INSERT INTO outbox_events(id,topic,payload,attempts,last_error_code) VALUES($1,'auth.email',$2,5,'DELIVERY_FAILED')",
    [id, { schemaVersion: 1, encryptedMessage: 'fixture-legacy-unreadable' }],
  );
  const path = '/api/v1/admin/operations/mail/' + id;
  const detail = await (await http.raw(path)).json();
  expect(detail.data.context).toBe(null);
  expect(detail.data.canRetry).toBe(false);
  const previous = (
    await stack.owner.pool.query(
      "SELECT count(*)::int AS n FROM outbox_events WHERE topic='auth.email'",
    )
  ).rows[0].n;
  const body = {
    action: 'acknowledge',
    expectedVersion: detail.data.version,
    reason: '已人工核对，结果未知不再次发送',
    confirmed: true,
  };
  const headers = { 'Idempotency-Key': randomUUID() };
  expect((await http.write(path, body, 'POST', headers)).status).toBe(200);
  expect((await http.write(path, body, 'POST', headers)).status).toBe(200);
  expect(
    (
      await stack.owner.pool.query(
        "SELECT count(*)::int AS n FROM outbox_events WHERE topic='auth.email'",
      )
    ).rows[0].n,
  ).toBe(previous);
  expect((await (await http.raw(path)).json()).data.disposition).not.toBe(null);
  expect((await stack.browser().raw(path)).status).toBe(401);
  const ordinary = stack.browser(),
    username = 'ordinary_' + randomBytes(5).toString('hex');
  await seedLegacyUnverified(stack.owner, {
    username,
    email: username + '@fixture.invalid',
    password: 'Fixture secure password 2026',
  });
  expect(
    (
      await ordinary.write('/api/v1/auth/login', {
        identifier: username,
        password: 'Fixture secure password 2026',
      })
    ).status,
  ).toBe(200);
  expect((await ordinary.raw(path)).status).toBe(403);
});

it('原忘记密码流程重新申请时替代旧令牌；真实SMTP只投递仍有效的新关联邮件', async () => {
  const http = await admin(),
    account = (await http.context()).data.account;
  if (!account) throw Error('缺少隔离账号');
  for (let n = 0; n < 2; n++)
    expect(
      (await http.write('/api/v1/auth/forgot-password', { email: account.email })).status,
    ).toBe(200);
  const messages = (
    await stack.owner.pool.query<{ event_id: string }>(
      "SELECT event_id FROM mail_task_contexts WHERE user_id=$1 AND purpose='password_reset' ORDER BY created_at",
      [account.id],
    )
  ).rows;
  expect(messages).toHaveLength(2);
  const previous = messages[0],
    current = messages[1];
  if (!previous || !current) throw Error('缺少真实重签发谱系');
  expect((await readMailContext(stack.owner, previous.event_id))?.state).toBe('token_consumed');
  expect((await readMailContext(stack.owner, current.event_id))?.state).toBe('valid');
  await stack.worker.resume();
  await stack.tick();
  await expect
    .poll(
      async () =>
        (
          await stack.owner.pool.query<{ status: string }>(
            'SELECT status FROM mail_deliveries WHERE event_id=$1',
            [current.event_id],
          )
        ).rows[0]?.status,
    )
    .toBe('sent');
  expect(
    (
      await stack.owner.pool.query<{ status: string }>(
        'SELECT status FROM mail_deliveries WHERE event_id=$1',
        [previous.event_id],
      )
    ).rows[0]?.status,
  ).toBe('failed');
  const origin = process.env['MAILPIT_API_ORIGIN'] ?? 'http://127.0.0.1:18025';
  const response = await fetch(
    origin + '/api/v1/search?query=' + encodeURIComponent('to:' + account.email),
    { signal: AbortSignal.timeout(3000) },
  );
  expect(response.status).toBe(200);
  const result: unknown = await response.json();
  expect(result).toEqual(expect.objectContaining({ messages: expect.any(Array) }));
  if (
    !result ||
    typeof result !== 'object' ||
    !('messages' in result) ||
    !Array.isArray(result.messages)
  )
    throw Error('Mailpit实际回执格式无效');
  expect(result.messages).toHaveLength(1);
});

it('邮箱成功变更后，真实安全审计绑定的旧邮箱提醒仍投递，不放宽普通旧地址邮件', async () => {
  const http = await admin(),
    account = (await http.context()).data.account;
  if (!account) throw Error('缺少隔离账号');
  const nextEmail = account.username + '_new@fixture.invalid';
  expect(
    (
      await http.write('/api/v1/me/security/email', {
        email: nextEmail,
        currentPassword: 'Fixture secure password 2026',
      })
    ).status,
  ).toBe(200);
  await stack.worker.resume();
  const code = await mailCode(nextEmail, '换绑邮箱', stack.tick);
  expect(
    (
      await http.write('/api/v1/me/security/email/confirm', {
        code,
        email: nextEmail,
        currentPassword: 'Fixture secure password 2026',
      })
    ).status,
  ).toBe(200);
  const row = (
    await stack.owner.pool.query<{ event_id: string }>(
      "SELECT c.event_id FROM mail_task_contexts c JOIN auth_audit_events a ON a.id=c.source_id WHERE c.user_id=$1 AND c.purpose='security_notice' AND c.source_type='auth_audit' AND a.event='auth.email_changed'",
      [account.id],
    )
  ).rows[0];
  if (!row) throw Error('缺少实际邮箱变更安全审计谱系');
  expect((await readMailContext(stack.owner, row.event_id))?.state).toBe('valid');
  const text = await mailText(account.email, '你的账号邮箱已完成变更', stack.tick);
  expect(text).toContain('所有旧会话与安全链接均已失效');
  expect(
    (
      await stack.owner.pool.query<{ status: string }>(
        'SELECT status FROM mail_deliveries WHERE event_id=$1',
        [row.event_id],
      )
    ).rows[0]?.status,
  ).toBe('sent');
});
