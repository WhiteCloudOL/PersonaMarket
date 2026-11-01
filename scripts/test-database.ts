import type { Database } from '@personamarket/database';

const created = new Set<string>();
const allowedName = /^pm_(?:it|e2e|auth|auth_case|auth_http)_[a-f0-9]{32}_test$/;
function checkName(name: string) {
  if (!allowedName.test(name)) throw new Error('拒绝操作非受控隔离测试库');
}

export async function createTestDatabase(owner: Database, name: string) {
  checkName(name);
  if (created.has(name)) throw new Error('测试库已由当前进程创建');
  await owner.pool.query(`CREATE DATABASE "${name}"`);
  created.add(name);
}

/** 仅回收本进程创建的库；连接泄漏必须显式失败，不能借维护预算隐藏 */
export async function dropTestDatabase(owner: Database, name: string) {
  checkName(name);
  if (!created.has(name)) throw new Error('拒绝删除并非当前进程创建的测试库');
  try {
    // pool.end可先于后端完全退出返回；由PostgreSQL原子的DROP判断连接，避免预查询竞态
    await owner.pool.query(`DROP DATABASE "${name}"`);
  } catch (cause) {
    if (!(cause instanceof Error) || !('code' in cause) || cause.code !== '55006') throw cause;
    const result = await owner.pool.query<{
      pid: number;
      state: string | null;
      wait_event_type: string | null;
      wait_event: string | null;
    }>('SELECT pid,state,wait_event_type,wait_event FROM pg_stat_activity WHERE datname=$1', [
      name,
    ]);
    console.error(
      JSON.stringify({ event: 'test.database.busy', database: name, connections: result.rows }),
    );
    throw new Error('TEST_DATABASE_STILL_CONNECTED', { cause });
  }
  created.delete(name);
}
