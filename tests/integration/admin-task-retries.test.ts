import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  AdminTaskListResponseSchema,
  AdminTaskRetryResponseSchema,
} from '@personamarket/contracts';
import { createDatabase } from '@personamarket/database';
import { createAdministrator, LocalStorage, storeImage } from '@personamarket/server';
import { createAuthStack } from '../fixtures/auth-stack.js';
import type { AuthHttp } from '../fixtures/auth-http.js';
import { fixturePng } from '../fixtures/image.js';
import { verifiedCreator } from '../fixtures/creator.js';
import { completePersona } from '../fixtures/creator.js';
import { marketPersona } from '../fixtures/market-personas.js';

let stack: Awaited<ReturnType<typeof createAuthStack>>;
const ownedStorageKeys: string[] = [];
function useTaskStack() {
  beforeAll(async () => {
    stack = await createAuthStack();
  });
  afterAll(async () => {
    try {
      if (stack)
        for (const key of ownedStorageKeys)
          await new LocalStorage(stack.env.STORAGE_ROOT).delete(key);
    } finally {
      ownedStorageKeys.length = 0;
      await stack?.close();
    }
  });
}
async function failure(http: AuthHttp, withAsset = false) {
  const account = (await http.context()).data.account;
  if (!account) throw Error('缺少隔离账号');
  const id = 'a' + randomUUID().slice(1),
    eventId = randomUUID();
  if (withAsset) {
    const application = createDatabase(stack.env.DATABASE_URL);
    try {
      const asset = await storeImage(
        application,
        new LocalStorage(stack.env.STORAGE_ROOT),
        account.id,
        'content',
        fixturePng,
        undefined,
        id,
      );
      ownedStorageKeys.push(asset.storageKey);
    } finally {
      await application.close();
    }
  }
  await stack.owner.pool.query(
    "INSERT INTO asset_jobs(id,owner_id,source_url,status,error_code) VALUES($1,$2,'https://retry-fixture.invalid/private-image.png','failed','IMAGE_IMPORT_FAILED')",
    [id, account.id],
  );
  await stack.owner.pool.query(
    "INSERT INTO outbox_events(id,topic,payload,attempts,delivered_at) VALUES($1,'asset.import',$2,1,now())",
    [eventId, { schemaVersion: 1, jobId: id.toUpperCase() }],
  );
  await stack.owner.pool.query(
    "INSERT INTO processed_events(consumer,event_id) VALUES('asset-import',$1)",
    [eventId],
  );
  return { id, eventId, ownerId: account.id };
}
async function command(http: AuthHttp, id: string) {
  const response = await http.raw('/api/v1/admin/tasks?category=images');
  expect(response.status).toBe(200);
  const task = AdminTaskListResponseSchema.parse(await response.json()).data.find(
    (row) => row.id === id,
  );
  if (!task) throw Error('未观测到真实失败任务');
  return {
    expectedVersion: task.version,
    reason: '已核对原任务与来源，确认重新处理',
    confirmed: true,
  };
}
function endpoint(id: string) {
  return '/api/v1/admin/tasks/image/' + id + '/retry';
}

describe('图片任务权限和并发交付', () => {
  useTaskStack();
  it('任务重试写接口拒绝匿名、用户和审核员，不因列表可见性放宽权限', async () => {
    const user = await verifiedCreator(stack);
    const task = await failure(user.http);
    const input = { expectedVersion: 'a'.repeat(64), reason: '核验任务后重试', confirmed: true };
    const headers = { 'Idempotency-Key': randomUUID() };
    expect((await stack.browser().write(endpoint(task.id), input, 'POST', headers)).status).toBe(
      401,
    );
    expect((await user.http.write(endpoint(task.id), input, 'POST', headers)).status).toBe(403);
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
    expect((await user.http.write(endpoint(task.id), input, 'POST', headers)).status).toBe(403);
  });

  it('图片失败任务产生新事件和不可变审计，同键重放不重复，旧回执不阻止实际Worker完成', async () => {
    const admin = await stack.admin(),
      task = await failure(admin.http, true),
      input = await command(admin.http, task.id),
      key = randomUUID();
    const response = await admin.http.write(endpoint(task.id.toUpperCase()), input, 'POST', {
      'Idempotency-Key': key,
    });
    expect(response.status).toBe(200);
    const result = AdminTaskRetryResponseSchema.parse(await response.json());
    expect(result.data).toMatchObject({ source: 'image', taskId: task.id, attempt: 1 });
    expect(result.data.eventId).not.toBe(task.eventId);
    const replay = await admin.http.write(endpoint(task.id), input, 'POST', {
      'Idempotency-Key': key,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    expect(
      (
        await admin.http.write(
          endpoint(task.id),
          { ...input, reason: '同一个键不能替换请求原因' },
          'POST',
          { 'Idempotency-Key': key },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await stack.owner.pool.query(
          'SELECT count(*)::int AS total FROM admin_task_retries WHERE task_id=$1',
          [task.id],
        )
      ).rows,
    ).toEqual([{ total: 1 }]);
    expect(
      (
        await stack.owner.pool.query(
          'SELECT previous_event_id,event_id,reason FROM admin_task_retries WHERE id=$1',
          [result.data.id],
        )
      ).rows,
    ).toEqual([
      { previous_event_id: task.eventId, event_id: result.data.eventId, reason: input.reason },
    ]);
    await stack.tick();
    await expect
      .poll(
        async () =>
          (await stack.owner.pool.query('SELECT status FROM asset_jobs WHERE id=$1', [task.id]))
            .rows[0]?.status,
      )
      .toBe('ready');
    await expect
      .poll(
        async () =>
          (
            await stack.owner.pool.query(
              "SELECT count(*)::int AS total FROM processed_events WHERE consumer='asset-import' AND event_id=$1",
              [result.data.eventId],
            )
          ).rows[0]?.total,
      )
      .toBe(1);
    expect(
      (
        await stack.owner.pool.query('SELECT count(*)::int AS total FROM assets WHERE id=$1', [
          task.id,
        ])
      ).rows,
    ).toEqual([{ total: 1 }]);
    await expect(
      stack.owner.pool.query(
        "UPDATE admin_task_retries SET reason='被篡改的操作原因' WHERE id=$1",
        [result.data.id],
      ),
    ).rejects.toThrow();
    await expect(
      stack.owner.pool.query('DELETE FROM admin_task_retries WHERE id=$1', [result.data.id]),
    ).rejects.toThrow();
  });

  it('双管理员同版本重试只允许一次，过期版本不会产生另一个事件或审计', async () => {
    const first = await stack.admin(),
      second = await stack.admin(),
      task = await failure(first.http),
      input = await command(first.http, task.id);
    const responses = await Promise.all(
      [first, second].map((admin) =>
        admin.http.write(endpoint(task.id), input, 'POST', { 'Idempotency-Key': randomUUID() }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
    const conflict = responses.find((response) => response.status === 412);
    if (!conflict) throw Error('未返回项目统一的版本前提冲突');
    expect(await conflict.json()).toMatchObject({ error: { code: 'REVISION_CONFLICT' } });
    expect(
      (
        await stack.owner.pool.query(
          'SELECT count(*)::int AS total FROM admin_task_retries WHERE task_id=$1',
          [task.id],
        )
      ).rows,
    ).toEqual([{ total: 1 }]);
  });

  it('规范化业务锁非阻塞保护正在处理的任务，大写路径也不能越锁恢复状态', async () => {
    const admin = await stack.admin(),
      task = await failure(admin.http),
      input = await command(admin.http, task.id),
      lock = await stack.owner.pool.connect();
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [task.id]);
      expect(
        (
          await admin.http.write(endpoint(task.id.toUpperCase()), input, 'POST', {
            'Idempotency-Key': randomUUID(),
          })
        ).status,
      ).toBe(409);
      expect(
        (await lock.query('SELECT status FROM asset_jobs WHERE id=$1', [task.id])).rows,
      ).toEqual([{ status: 'failed' }]);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
    }
    expect(
      (
        await stack.owner.pool.query(
          'SELECT count(*)::int AS total FROM admin_task_retries WHERE task_id=$1',
          [task.id],
        )
      ).rows,
    ).toEqual([{ total: 0 }]);
  });

  it('操作者近期MFA过期时连同键成功重放也拒绝，页面读取仍可使用有效会话', async () => {
    const admin = await stack.admin(),
      task = await failure(admin.http),
      input = await command(admin.http, task.id),
      key = randomUUID();
    expect(
      (await admin.http.write(endpoint(task.id), input, 'POST', { 'Idempotency-Key': key })).status,
    ).toBe(200);
    await stack.owner.pool.query(
      "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=$1 AND revoked_at IS NULL",
      [task.ownerId],
    );
    expect((await admin.http.raw('/api/v1/admin/tasks')).status).toBe(200);
    const replay = await admin.http.write(endpoint(task.id), input, 'POST', {
      'Idempotency-Key': key,
    });
    expect(replay.status).toBe(403);
    expect(await replay.json()).toMatchObject({ error: { code: 'MFA_REQUIRED' } });
  });
});

describe('受控重试的账号、额度和审计边界', () => {
  useTaskStack();

  it.each(['banned', 'unverified'] as const)('所属账号%s时不能替其恢复远程任务', async (state) => {
    const operator = await stack.admin(),
      owner = await stack.admin(),
      task = await failure(owner.http),
      input = await command(operator.http, task.id);
    if (state === 'banned')
      await stack.owner.pool.query("UPDATE users SET status='banned' WHERE id=$1", [task.ownerId]);
    else
      await stack.owner.pool.query('UPDATE users SET email_verified_at=NULL WHERE id=$1', [
        task.ownerId,
      ]);
    expect(
      (
        await operator.http.write(endpoint(task.id), input, 'POST', {
          'Idempotency-Key': randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(
      (await stack.owner.pool.query('SELECT status FROM asset_jobs WHERE id=$1', [task.id])).rows,
    ).toEqual([{ status: 'failed' }]);
    expect(
      (
        await stack.owner.pool.query(
          'SELECT count(*)::int AS total FROM admin_task_retries WHERE task_id=$1',
          [task.id],
        )
      ).rows,
    ).toEqual([{ total: 0 }]);
  });

  async function priorRetries(
    task: { id: string; eventId: string; ownerId: string },
    total: number,
    recent = false,
  ) {
    for (let attempt = 1; attempt <= total; attempt++)
      await stack.owner.pool.query(
        "INSERT INTO admin_task_retries(source,task_id,event_id,previous_event_id,actor_id,attempt,expected_version,reason,created_at) VALUES('image',$1,$2,$3,$4,$5,$6,'隔离历史重试边界夹具',now()-$7*interval '1 second')",
        [
          task.id,
          randomUUID(),
          task.eventId,
          task.ownerId,
          attempt,
          String(attempt).repeat(64),
          recent ? 0 : (4 - attempt) * 120,
        ],
      );
  }
  it('冷却期禁止新事件且保留失败状态，审计读取不要求近期MFA', async () => {
    const admin = await stack.admin(),
      task = await failure(admin.http),
      input = await command(admin.http, task.id);
    await priorRetries(task, 1, true);
    const response = await admin.http.write(endpoint(task.id), input, 'POST', {
      'Idempotency-Key': randomUUID(),
    });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(response.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    expect(
      (await stack.owner.pool.query('SELECT status FROM asset_jobs WHERE id=$1', [task.id])).rows,
    ).toEqual([{ status: 'failed' }]);
    await stack.owner.pool.query(
      "UPDATE auth_sessions SET mfa_verified_at=now()-interval '11 minutes' WHERE user_id=$1 AND revoked_at IS NULL",
      [task.ownerId],
    );
    const history = await admin.http.raw(
      '/api/v1/admin/tasks/image/' + task.id.toUpperCase() + '/retries',
    );
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({
      data: [{ taskId: task.id, attempt: 1, reason: '隔离历史重试边界夹具' }],
      meta: { maxAttempts: 3, cooldownSeconds: 60 },
    });
  });
  it('三次人工重试上限由API和数据库约束共同保护，不能继续创建第四次', async () => {
    const admin = await stack.admin(),
      task = await failure(admin.http),
      input = await command(admin.http, task.id);
    await priorRetries(task, 3);
    expect(
      (
        await admin.http.write(endpoint(task.id), input, 'POST', {
          'Idempotency-Key': randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await stack.owner.pool.query(
          'SELECT count(*)::int AS total FROM admin_task_retries WHERE task_id=$1',
          [task.id],
        )
      ).rows,
    ).toEqual([{ total: 3 }]);
    await expect(
      stack.owner.pool.query(
        "INSERT INTO admin_task_retries(source,task_id,event_id,actor_id,attempt,expected_version,reason) VALUES('image',$1,$2,$3,4,$4,'第四次必须被数据库拒绝')",
        [task.id, randomUUID(), task.ownerId, 'f'.repeat(64)],
      ),
    ).rejects.toThrow();
    const application = createDatabase(stack.env.DATABASE_URL);
    try {
      expect(
        (
          await application.pool.query(
            "SELECT has_table_privilege(current_user,'admin_task_retries','UPDATE') AS can_update,has_table_privilege(current_user,'admin_task_retries','DELETE') AS can_delete",
          )
        ).rows,
      ).toEqual([{ can_update: false, can_delete: false }]);
    } finally {
      await application.close();
    }
  });
  it('真实跨任务并发额度已满时拒绝恢复，失败任务不会占据第四个名额', async () => {
    const admin = await stack.admin(),
      task = await failure(admin.http),
      input = await command(admin.http, task.id);
    await stack.owner.pool.query(
      "INSERT INTO asset_jobs(owner_id,source_url,status) SELECT $1,'https://capacity-fixture.invalid/image.png','pending' FROM generate_series(1,3)",
      [task.ownerId],
    );
    expect(
      (
        await admin.http.write(endpoint(task.id), input, 'POST', {
          'Idempotency-Key': randomUUID(),
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await stack.owner.pool.query(
          'SELECT count(*)::int AS total FROM admin_task_retries WHERE task_id=$1',
          [task.id],
        )
      ).rows,
    ).toEqual([{ total: 0 }]);
  });
  it('分发耗尽的原pending任务重试复用自身并发名额，不能被重复计算', async () => {
    const admin = await stack.admin(),
      task = await failure(admin.http);
    await stack.owner.pool.query(
      "UPDATE asset_jobs SET status='pending',error_code=NULL WHERE id=$1",
      [task.id],
    );
    await stack.owner.pool.query(
      "DELETE FROM processed_events WHERE consumer='asset-import' AND event_id=$1",
      [task.eventId],
    );
    await stack.owner.pool.query(
      "UPDATE outbox_events SET attempts=5,delivered_at=NULL,last_error_code='DELIVERY_FAILED' WHERE id=$1",
      [task.eventId],
    );
    await stack.owner.pool.query(
      "INSERT INTO asset_jobs(owner_id,source_url,status) SELECT $1,'https://capacity-fixture.invalid/image.png','pending' FROM generate_series(1,2)",
      [task.ownerId],
    );
    const input = await command(admin.http, task.id);
    expect(
      (
        await admin.http.write(endpoint(task.id), input, 'POST', {
          'Idempotency-Key': randomUUID(),
        })
      ).status,
    ).toBe(200);
  });
  it('未绑定MFA的过期管理员会话返回REAUTH_REQUIRED，列表和审计仍可读取', async () => {
    const username = 'unbound_' + randomUUID().replaceAll('-', '').slice(0, 10),
      password = 'Unbound retry fixture passphrase 2026';
    await createAdministrator(stack.owner, {
      username,
      password,
      email: username + '@fixture.invalid',
    });
    const http = stack.browser();
    expect(
      (await http.write('/api/v1/auth/login', { identifier: username, password })).status,
    ).toBe(200);
    const task = await failure(http),
      input = await command(http, task.id);
    await stack.owner.pool.query(
      "UPDATE auth_sessions SET created_at=now()-interval '11 minutes' WHERE user_id=$1 AND revoked_at IS NULL",
      [task.ownerId],
    );
    const response = await http.write(endpoint(task.id), input, 'POST', {
      'Idempotency-Key': randomUUID(),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'REAUTH_REQUIRED' } });
    expect((await http.raw('/api/v1/admin/tasks/image/' + task.id + '/retries')).status).toBe(200);
  });
  it('缺少确认、幂等键或账号已切换时不创建重试，未知请求字段被拒绝', async () => {
    const admin = await stack.admin(),
      task = await failure(admin.http),
      input = await command(admin.http, task.id);
    const headers = { 'Idempotency-Key': randomUUID() };
    expect(
      (await admin.http.write(endpoint(task.id), { ...input, confirmed: false }, 'POST', headers))
        .status,
    ).toBe(400);
    expect(
      (
        await admin.http.write(
          endpoint(task.id),
          { ...input, ownerId: randomUUID() },
          'POST',
          headers,
        )
      ).status,
    ).toBe(400);
    expect((await admin.http.write(endpoint(task.id), input)).status).toBe(400);
    expect(
      (
        await admin.http.write(endpoint(task.id), input, 'POST', {
          ...headers,
          'X-Expected-Account': randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await stack.owner.pool.query(
          'SELECT count(*)::int AS total FROM admin_task_retries WHERE task_id=$1',
          [task.id],
        )
      ).rows,
    ).toEqual([{ total: 0 }]);
  });
});

async function marketFailure(http: AuthHttp) {
  const account = (await http.context()).data.account;
  if (!account) throw Error('缺少隔离账号');
  const id = 'a' + randomUUID().slice(1),
    previewId = randomUUID(),
    eventId = randomUUID();
  await stack.owner.pool.query(
    "INSERT INTO market_imports(id,owner_id,format,state,filename,content_hash,document,expires_at) VALUES($1,$2,'market-json','ready','retry.persona.json',$3,$4,now()+interval '1 hour')",
    [previewId, account.id, 'a'.repeat(64), marketPersona()],
  );
  await stack.owner.pool.query(
    "INSERT INTO market_import_assets(id,preview_id,package_key,storage_key,source_url,expected_mime,expected_bytes,expected_hash,status) VALUES($1,$2,$3,$4,'https://market-retry-fixture.invalid/image.png','image/png',$5,$6,'failed')",
    [
      id,
      previewId,
      randomUUID(),
      randomUUID().replaceAll('-', '') + '.webp',
      fixturePng.length,
      'b'.repeat(64),
    ],
  );
  await stack.owner.pool.query(
    "INSERT INTO outbox_events(id,topic,payload,attempts,delivered_at) VALUES($1,'market.image',$2,1,now())",
    [eventId, { schemaVersion: 1, assetId: id }],
  );
  return { id, previewId, eventId };
}
describe('导入包图片任务的预览生命周期', () => {
  useTaskStack();
  it('导入包图片核验有效私有预览后恢复queued并创建规范化新事件', async () => {
    const admin = await stack.admin(),
      task = await marketFailure(admin.http),
      input = await command(admin.http, task.id);
    const response = await admin.http.write(
      '/api/v1/admin/tasks/market_image/' + task.id.toUpperCase() + '/retry',
      input,
      'POST',
      { 'Idempotency-Key': randomUUID() },
    );
    expect(response.status).toBe(200);
    const retry = AdminTaskRetryResponseSchema.parse(await response.json()).data;
    expect(retry).toMatchObject({
      source: 'market_image',
      taskId: task.id,
      previousEventId: task.eventId,
      attempt: 1,
    });
    expect(
      (
        await stack.owner.pool.query('SELECT status FROM market_import_assets WHERE id=$1', [
          task.id,
        ])
      ).rows,
    ).toEqual([{ status: 'queued' }]);
    expect(
      (
        await stack.owner.pool.query('SELECT topic,payload FROM outbox_events WHERE id=$1', [
          retry.eventId,
        ])
      ).rows,
    ).toEqual([{ topic: 'market.image', payload: { schemaVersion: 1, assetId: task.id } }]);
  });
  it.each(['expired', 'consumed', 'failed'] as const)(
    '导入包预览%s后不能重试图片或产生新Outbox',
    async (state) => {
      const admin = await stack.admin(),
        task = await marketFailure(admin.http);
      if (state === 'expired')
        await stack.owner.pool.query(
          "UPDATE market_imports SET expires_at=now()-interval '1 second' WHERE id=$1",
          [task.previewId],
        );
      else if (state === 'failed')
        await stack.owner.pool.query("UPDATE market_imports SET state='failed' WHERE id=$1", [
          task.previewId,
        ]);
      else {
        const persona = await completePersona(admin.http);
        await stack.owner.pool.query(
          'UPDATE market_imports SET consumed_at=now(),confirmation_hash=$2,result_persona_id=$3 WHERE id=$1',
          [task.previewId, 'c'.repeat(64), persona.id],
        );
      }
      const input = await command(admin.http, task.id);
      expect(
        (
          await admin.http.write(
            '/api/v1/admin/tasks/market_image/' + task.id + '/retry',
            input,
            'POST',
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await stack.owner.pool.query(
            'SELECT count(*)::int AS total FROM admin_task_retries WHERE task_id=$1',
            [task.id],
          )
        ).rows,
      ).toEqual([{ total: 0 }]);
    },
  );
});
