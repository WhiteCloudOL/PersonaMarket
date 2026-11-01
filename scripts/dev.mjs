import { createDatabase } from '@personamarket/database';
import { parseServerEnvironment, probeRedis, webEnvironment } from '@personamarket/server';
import { environment, pnpm, supervise } from './runtime.mjs';

try {
  const source = environment();
  const config = parseServerEnvironment(source);
  const database = createDatabase(config.DATABASE_URL);
  try {
    const result = await database.pool.query("SELECT 1 FROM site_settings WHERE key = 'brand'");
    if (result.rowCount !== 1) throw new Error('缺少初始化配置，请先执行 pnpm db:migrate。');
    await probeRedis(config.REDIS_URL);
  } finally {
    await database.close();
  }
  const system = webEnvironment(source);
  const backend = {
    ...system,
    ...Object.fromEntries(Object.entries(config).map(([key, value]) => [key, String(value)])),
  };
  supervise([
    pnpm(['--filter', '@personamarket/api', 'dev'], backend),
    pnpm(['--filter', '@personamarket/worker', 'dev'], backend),
    pnpm(['--filter', '@personamarket/web', 'dev'], { ...system, PORT: '3000' }),
  ]);
} catch (cause) {
  console.error(
    cause.message?.startsWith('环境配置无效') || cause.message?.startsWith('缺少初始化配置')
      ? cause.message
      : '开发依赖不可用，请检查环境并执行 pnpm infra:up / pnpm db:migrate。',
  );
  process.exitCode = 1;
}
