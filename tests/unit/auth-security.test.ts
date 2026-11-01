import { describe, expect, it } from 'vitest';
import { hashPassword, openSecret, sealSecret, verifyPassword } from '@personamarket/server';

describe('认证密码与加密边界', () => {
  it('Argon2id 保留 Unicode 与空白，盐独立且拒绝损坏的编码', async () => {
    const password = ' 安全密码 🦆 long passphrase ';
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toBe(second);
    expect(await verifyPassword(first, password)).toBe(true);
    expect(await verifyPassword(first, password.trim())).toBe(false);
    expect(await verifyPassword('corrupt-phc', password)).toBe(false);
  });
  it('AES-GCM 信封隔离用途和用户，拒绝篡改与错钥', () => {
    const key = 'a1'.repeat(32);
    const message = '真实邮件与二次验证秘密';
    const envelope = sealSecret(key, 'mfa:user-1', message);
    expect(envelope).not.toContain(message);
    expect(sealSecret(key, 'mfa:user-1', message)).not.toBe(envelope);
    expect(openSecret(key, 'mfa:user-1', envelope)).toBe(message);
    expect(() => openSecret(key, 'mfa:user-2', envelope)).toThrow();
    expect(() => openSecret('b2'.repeat(32), 'mfa:user-1', envelope)).toThrow();
    const pieces = envelope.split('.');
    pieces[3] = 'AA' + pieces[3]?.slice(2);
    expect(() => openSecret(key, 'mfa:user-1', pieces.join('.'))).toThrow();
    expect(() => openSecret(key, 'mfa:user-1', envelope + '.extra')).toThrow();
  });
});
