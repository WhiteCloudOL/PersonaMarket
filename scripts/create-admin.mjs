import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { createDatabase } from '@personamarket/database';
import { createAdministrator } from '@personamarket/server';
import { environment } from './runtime.mjs';

const env = environment();
if (!env.MIGRATION_DATABASE_URL) throw new Error('请配置受控的 MIGRATION_DATABASE_URL');
const database = createDatabase(env.MIGRATION_DATABASE_URL);
try {
  let input;
  if (process.stdin.isTTY) {
    let hidden = false;
    const output = new Writable({
      write(chunk, encoding, done) {
        if (!hidden) process.stdout.write(chunk, encoding);
        done();
      },
    });
    const prompt = createInterface({ input: process.stdin, output, terminal: true });
    try {
      const username = await prompt.question('管理员用户名：');
      const email = await prompt.question('受控管理员邮箱：');
      process.stdout.write('登录密码（输入隐藏，12 至 64 个字符）：');
      hidden = true;
      const password = await prompt.question('');
      hidden = false;
      process.stdout.write('\n');
      input = { username, email, password };
    } finally {
      prompt.close();
      output.end();
    }
  } else input = JSON.parse(readFileSync(0, 'utf8'));
  const created = await createAdministrator(database, input);
  console.log(`管理员 ${created.username} 已创建，可在账号与安全中自愿绑定 MFA`);
} catch {
  console.error('管理员创建失败，请核对输入、唯一身份和数据库连接');
  process.exitCode = 1;
} finally {
  await database.close();
}
