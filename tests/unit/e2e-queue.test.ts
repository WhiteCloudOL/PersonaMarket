import { expect, it } from 'vitest';
import { e2eQueueName } from '../../scripts/e2e-queue.js';

it('队列身份绑定测试库与主机，应用角色或凭据变化不改变同一个数据库的队列', () => {
  const owner = e2eQueueName('postgresql://owner:fixture@127.0.0.1:5432/pm_fixture_test');
  expect(owner).toMatch(/^e2e-[a-f0-9]{24}$/);
  expect(e2eQueueName('postgres://app:other-fixture@127.0.0.1/pm_fixture_test')).toBe(owner);
  expect(e2eQueueName('postgres://app:fixture@127.0.0.1/pm_other_test')).not.toBe(owner);
  expect(e2eQueueName('postgres://app:fixture@127.0.0.2/pm_fixture_test')).not.toBe(owner);
});
it('普通业务库、非PostgreSQL地址与编码路径不能成为E2E队列归属', () => {
  for (const url of [
    'postgres://fixture@localhost/personamarket',
    'sqlite://localhost/pm_fixture_test',
    'postgres://fixture@localhost/pm%2Ffixture_test',
  ])
    expect(() => e2eQueueName(url)).toThrow('E2E队列要求显式独立测试数据库');
});
