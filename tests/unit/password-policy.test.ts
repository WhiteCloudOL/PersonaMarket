import { expect, it } from 'vitest';
import { assertNewPassword } from '@personamarket/server';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
it('本地常见密码数据与固定上游 Git blob 完全一致', () => {
  const rows = z
    .array(z.string())
    .length(10000)
    .parse(
      JSON.parse(
        readFileSync(
          new URL('../../packages/server/src/data/common-passwords.json', import.meta.url),
          'utf8',
        ),
      ),
    );
  const raw = Buffer.from(rows.join('\n') + '\n');
  expect(
    createHash('sha1')
      .update(Buffer.from('blob ' + raw.length + '\0'))
      .update(raw)
      .digest('hex'),
  ).toBe('e2bb6b64d278ae8854f0fd86913d01c899356b55');
});
it('拒绝完整常见口令、重复字符和账号口令，保留长句中的普通单词', () => {
  for (const value of [
    'passwordpassword',
    '12345678901234567890',
    'a'.repeat(20),
    'long_username_20262026',
  ])
    expect(() =>
      assertNewPassword(value, { username: 'long_username_2026', email: 'writer@fixture.invalid' }),
    ).toThrow('容易被猜到');
  expect(() => assertNewPassword('我的 password 是一段独特的长句 🦆')).not.toThrow();
  expect(() => assertNewPassword(' Retain Unicode and spaces 密码 ')).not.toThrow();
});
