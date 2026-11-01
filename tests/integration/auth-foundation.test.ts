import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  authSessions,
  authTokens,
  consumeAuthToken,
  createDatabase,
  createTestDatabaseOwner,
  findActiveSession,
  migrateDatabase,
  users,
  type Database,
} from '@personamarket/database';
import { issueAuthSecret } from '@personamarket/server';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';

const source = process.env['TEST_DATABASE_URL'];
if (!source || !new URL(source).pathname.endsWith('_test'))
  throw new Error('认证集成测试要求独立测试数据库');
const administrator = createTestDatabaseOwner(source);
let database: Database;
let name: string;
// 仅测存储约束的合成编码，不用于验证密码或建立可登录的账号。
const hashFixture =
  '$argon2id$v=19$m=65536,t=3,p=1$' +
  randomBytes(16).toString('base64').replaceAll('=', '') +
  '$' +
  randomBytes(32).toString('base64').replaceAll('=', '');

beforeEach(async () => {
  name = 'pm_auth_' + randomUUID().replaceAll('-', '') + '_test';
  if (!/^pm_auth_[a-f0-9]{32}_test$/.test(name)) throw new Error('隔离库名无效');
  await createTestDatabase(administrator, name);
  const url = new URL(source);
  url.pathname = '/' + name;
  database = createDatabase(url.toString());
  // Reproduce init-app.sh's per-database default grants before migrations.
  await database.pool.query('GRANT USAGE ON SCHEMA public TO personamarket_app');
  await database.pool.query(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO personamarket_app',
  );
  await migrateDatabase(url.toString());
});
afterEach(async () => {
  await database?.close();
  if (name) await dropTestDatabase(administrator, name);
});
afterAll(async () => {
  await administrator.close();
});

async function account(role: 'user' | 'admin' = 'user') {
  const username = 'u' + randomUUID().replaceAll('-', '').slice(0, 24);
  const [row] = await database.db
    .insert(users)
    .values({ username, email: username + '@fixture.invalid', passwordHash: hashFixture, role })
    .returning();
  if (!row) throw new Error('测试账号创建失败');
  return row;
}
async function token(purpose: 'email_verify' | 'password_reset' = 'email_verify', expired = false) {
  const user = await account();
  const secret = issueAuthSecret(purpose);
  await database.db.insert(authTokens).values({
    userId: user.id,
    purpose,
    tokenHash: secret.hash,
    createdAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + (expired ? -1000 : 60_000)),
  });
  return { user, ...secret };
}

describe('认证持久化与不可绕过的约束', () => {
  it('第一位普通账号仍是 user，规范化身份唯一，不允许明文密码与无效状态', async () => {
    const user = await account();
    expect(user.role).toBe('user');
    await expect(
      database.pool.query('INSERT INTO users (username,email,password_hash) VALUES ($1,$2,$3)', [
        user.username,
        'another@fixture.invalid',
        hashFixture,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      database.pool.query('INSERT INTO users (username,email,password_hash) VALUES ($1,$2,$3)', [
        'another_user',
        user.email,
        hashFixture,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    for (const [field, value] of [
      ['username', 'Uppercase'],
      ['email', ' Mixed@Example.com '],
      ['email', '\twriter@example.com'],
      ['password_hash', 'plaintext'],
      ['role', 'owner'],
      ['status', 'unknown'],
    ] as const) {
      await expect(
        database.pool.query(`UPDATE users SET ${field}=$1 WHERE id=$2`, [value, user.id]),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });
  it('会话每次读取账户状态、安全版本与过期/撤销标记，结果不含秘密字段', async () => {
    const user = await account();
    const secret = issueAuthSecret('session');
    const [session] = await database.db
      .insert(authSessions)
      .values({
        userId: user.id,
        tokenHash: secret.hash,
        csrfTokenHash: issueAuthSecret('csrf').hash,
        securityVersion: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!session) throw new Error('会话未创建');
    const identity = await findActiveSession(database, secret.hash);
    expect(identity?.userId).toBe(user.id);
    expect(Object.keys(identity ?? {})).not.toContain('tokenHash');
    expect(JSON.stringify(identity)).not.toContain(user.passwordHash);
    await database.db.update(users).set({ status: 'banned' }).where(eq(users.id, user.id));
    expect(await findActiveSession(database, secret.hash)).toBeUndefined();
    await database.db.update(users).set({ status: 'active' }).where(eq(users.id, user.id));
    expect(await findActiveSession(database, secret.hash)).toBeUndefined();
    await database.db
      .update(authSessions)
      .set({ securityVersion: 3, revokedAt: new Date() })
      .where(eq(authSessions.id, session.id));
    expect(await findActiveSession(database, secret.hash)).toBeUndefined();
    await database.db
      .update(authSessions)
      .set({
        revokedAt: null,
        createdAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 60_000),
      })
      .where(eq(authSessions.id, session.id));
    expect(await findActiveSession(database, secret.hash)).toBeUndefined();
    await expect(
      database.pool.query('UPDATE users SET security_version=1 WHERE id=$1', [user.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('验证令牌消费与账户变更同一事务，失败回滚后可重试，成功后不能重放', async () => {
    const secret = await token();
    await expect(
      consumeAuthToken(database, 'email_verify', secret.hash, async (transaction, identity) => {
        await transaction
          .update(users)
          .set({ emailVerifiedAt: sql`clock_timestamp()` })
          .where(eq(users.id, identity.userId));
        throw new Error('synthetic rollback');
      }),
    ).rejects.toThrow('synthetic rollback');
    const [before] = await database.db.select().from(users).where(eq(users.id, secret.user.id));
    expect(before?.emailVerifiedAt).toBeNull();
    expect(
      await consumeAuthToken(
        database,
        'email_verify',
        secret.hash,
        async (transaction, identity) => {
          await transaction
            .update(users)
            .set({ emailVerifiedAt: sql`clock_timestamp()` })
            .where(eq(users.id, identity.userId));
          return identity.userId;
        },
      ),
    ).toEqual({ consumed: true, value: secret.user.id });
    expect(
      await consumeAuthToken(database, 'email_verify', secret.hash, async () => {
        throw new Error('must not run');
      }),
    ).toEqual({ consumed: false });
    const [after] = await database.db.select().from(users).where(eq(users.id, secret.user.id));
    expect(after?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(after?.securityVersion).toBe(2);
  });
  it('并发消费只能成功一次，错误用途和过期令牌均不执行回调', async () => {
    const secret = await token();
    const results = await Promise.all(
      Array.from({ length: 2 }, () =>
        consumeAuthToken(database, 'email_verify', secret.hash, async () => 'done'),
      ),
    );
    expect(results.filter((result) => result.consumed)).toHaveLength(1);
    const expired = await token('email_verify', true);
    for (const [purpose, hash] of [
      ['email_verify', expired.hash],
      ['password_reset', secret.hash],
    ] as const)
      expect(
        await consumeAuthToken(database, purpose, hash, async () => {
          throw new Error('must not run');
        }),
      ).toEqual({ consumed: false });
  });
  it('数据库不接受原始令牌，改邮箱令牌必须绑定规范化的新邮箱', async () => {
    const user = await account();
    const secret = issueAuthSecret('email_change');
    await expect(
      database.pool.query(
        "INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at) VALUES ($1,'email_verify',$2,now()+interval '1 minute')",
        [user.id, secret.token],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      database.pool.query(
        "INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at) VALUES ($1,'email_change',$2,now()+interval '1 minute')",
        [user.id, secret.hash],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('最后一个管理员不能删除、降级或停用，运行账户不能破坏保护哨兵', async () => {
    const admin = await account('admin');
    for (const statement of [
      'DELETE FROM users WHERE id=$1',
      "UPDATE users SET role='user' WHERE id=$1",
      "UPDATE users SET status='banned' WHERE id=$1",
    ])
      await expect(database.pool.query(statement, [admin.id])).rejects.toMatchObject({
        code: '23514',
      });
    const client = await database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE personamarket_app');
      await expect(client.query('DELETE FROM auth_admin_guard')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    const other = await account('admin');
    const runtime = await database.pool.connect();
    try {
      await runtime.query('BEGIN');
      await runtime.query('SET LOCAL ROLE personamarket_app');
      await runtime.query("UPDATE users SET role='user' WHERE id=$1", [admin.id]);
      await runtime.query('COMMIT');
      await runtime.query('BEGIN');
      await runtime.query('SET LOCAL ROLE personamarket_app');
      await expect(
        runtime.query('DELETE FROM users WHERE id=$1', [other.id]),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await runtime.query('ROLLBACK');
      runtime.release();
    }
    expect((await database.db.select().from(users).where(eq(users.id, other.id)))[0]?.role).toBe(
      'admin',
    );
  });
  for (const isolation of ['READ COMMITTED', 'REPEATABLE READ'] as const)
    it(`${isolation} 下两个管理员并发降级仍保留一位`, async () => {
      const admins = await Promise.all([account('admin'), account('admin')]);
      const clients = await Promise.all([database.pool.connect(), database.pool.connect()]);
      try {
        await Promise.all(
          clients.map(async (client) => {
            await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
            await client.query('SELECT count(*) FROM users');
          }),
        );
        const results = await Promise.allSettled(
          clients.map(async (client, index) => {
            try {
              await client.query("UPDATE users SET role='user' WHERE id=$1", [admins[index]?.id]);
              await client.query('COMMIT');
            } catch (error) {
              await client.query('ROLLBACK');
              throw error;
            }
          }),
        );
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(
          (
            await database.pool.query(
              "SELECT count(*)::int AS count FROM users WHERE role='admin' AND status='active'",
            )
          ).rows[0]?.count,
        ).toBe(1);
      } finally {
        for (const client of clients) {
          await client.query('ROLLBACK');
          client.release();
        }
      }
    });
});
