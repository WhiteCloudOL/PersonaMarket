import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createDatabase, createTestDatabaseOwner } from '@personamarket/database';
import { createTestDatabase, dropTestDatabase } from '../../scripts/test-database.js';

it('测试维护预算独立于业务，拒绝非受控库和仍连接的隔离库且不强制断开', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source) throw new Error('缺少 TEST_DATABASE_URL');
  const ordinary = createDatabase(source);
  const owner = createTestDatabaseOwner(source);
  const name = 'pm_it_' + randomUUID().replaceAll('-', '') + '_test';
  let created = false;
  let held: ReturnType<typeof createDatabase> | undefined;
  try {
    expect((await ordinary.pool.query('SHOW statement_timeout')).rows[0]?.statement_timeout).toBe(
      '5s',
    );
    expect((await owner.pool.query('SHOW statement_timeout')).rows[0]?.statement_timeout).toBe(
      '15s',
    );
    expect((await owner.pool.query('SHOW lock_timeout')).rows[0]?.lock_timeout).toBe('1s');
    await expect(createTestDatabase(owner, 'business')).rejects.toThrow('非受控');
    await expect(dropTestDatabase(owner, name)).rejects.toThrow('并非当前进程');
    await createTestDatabase(owner, name);
    created = true;
    const url = new URL(source);
    url.pathname = '/' + name;
    held = createDatabase(url.href);
    await held.pool.query('SELECT 1');
    await expect(dropTestDatabase(owner, name)).rejects.toThrow('TEST_DATABASE_STILL_CONNECTED');
    expect((await held.pool.query('SELECT 1 AS value')).rows[0]?.value).toBe(1);
    await held.close();
    held = undefined;
    await dropTestDatabase(owner, name);
    created = false;
  } finally {
    await held?.close();
    if (created) await dropTestDatabase(owner, name);
    await ordinary.close();
    await owner.close();
  }
});
