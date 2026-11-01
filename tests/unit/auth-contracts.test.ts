import { describe, expect, it } from 'vitest';
import {
  AuthTokenHashSchema,
  EmailSchema,
  LoginRequestSchema,
  NewPasswordSchema,
  OpaqueAuthTokenSchema,
  RegisterRequestSchema,
  UsernameSchema,
} from '@personamarket/contracts';
import { hashAuthSecret, issueAuthSecret } from '@personamarket/server';

describe('认证契约与高熵令牌', () => {
  it('统一邮箱与用户名，拒绝客户端角色或验证状态', () => {
    expect(UsernameSchema.parse('  YunYa_01 ')).toBe('yunya_01');
    expect(EmailSchema.parse(' Person@Example.COM ')).toBe('person@example.com');
    const input = {
      username: 'writer',
      email: 'writer@example.com',
      password: 'long passphrase for testing',
    };
    expect(RegisterRequestSchema.safeParse(input).success).toBe(true);
    for (const key of ['role', 'emailVerified', 'status', 'id'])
      expect(RegisterRequestSchema.safeParse({ ...input, [key]: 'forged' }).success).toBe(false);
    for (const value of ['ab', 'has/slash', 'with space', '1first', 'x'.repeat(33)])
      expect(UsernameSchema.safeParse(value).success).toBe(false);
    expect(
      LoginRequestSchema.parse({ identifier: ' Person@Example.COM ', password: 'original' })
        .identifier,
    ).toBe('person@example.com');
  });
  it('新密码按 Unicode 字符计数且不改写，登录验证允许历史密码长度', () => {
    const value = ' 这是保留空白的中文安全口令示例 🦆 ';
    expect(NewPasswordSchema.parse(value)).toBe(value);
    expect(NewPasswordSchema.safeParse('a'.repeat(11)).success).toBe(false);
    expect(NewPasswordSchema.safeParse('🦆'.repeat(12)).success).toBe(true);
    expect(NewPasswordSchema.safeParse('🦆'.repeat(64)).success).toBe(true);
    expect(NewPasswordSchema.safeParse('🦆'.repeat(65)).success).toBe(false);
    expect(NewPasswordSchema.safeParse(' '.repeat(15)).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ identifier: 'writer', password: 'short' }).success).toBe(
      true,
    );
  });
  it('随机令牌只存用途隔离的哈希，拒绝异常与非规范编码', () => {
    const first = issueAuthSecret('email_verify');
    const second = issueAuthSecret('email_verify');
    expect(OpaqueAuthTokenSchema.safeParse(first.token).success).toBe(true);
    expect(AuthTokenHashSchema.safeParse(first.hash).success).toBe(true);
    expect(first.token).not.toBe(second.token);
    expect(first.hash).not.toBe(first.token);
    expect(hashAuthSecret('email_verify', first.token)).toBe(first.hash);
    expect(hashAuthSecret('password_reset', first.token)).not.toBe(first.hash);
    for (const value of ['', first.token + '=', first.token.slice(0, -1) + 'B', 'a'.repeat(10000)])
      expect(hashAuthSecret('session', value)).toBeUndefined();
  });
});
