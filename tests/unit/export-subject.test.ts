import { expect, it } from 'vitest';
import { exportSubject } from '@personamarket/server';
const key = '0123456789abcdef'.repeat(4);
const now = Date.parse('2026-10-27T12:30:00Z');
it('匿名签名标识可在同一UTC日复用，跨日轮换且不产生IP或设备指纹', () => {
  const first = exportSubject(key, undefined, undefined, now);
  const repeated = exportSubject(key, first.cookie, undefined, now + 1000);
  expect(repeated.hash).toBe(first.hash);
  expect(repeated.cookie).toBe(first.cookie);
  expect(first.day).toBe('2026-10-27');
  expect(first.maxAge).toBe(11.5 * 3600_000);
  const next = exportSubject(key, first.cookie, undefined, now + 86400_000);
  expect(next.hash).not.toBe(first.hash);
  expect(next.cookie).not.toBe(first.cookie);
});
it('篡改签名、重复分隔和非规范输入重新发匿名标识', () => {
  const original = exportSubject(key, undefined, undefined, now);
  for (const token of [
    original.cookie.slice(0, -1) + (original.cookie.endsWith('a') ? 'b' : 'a'),
    original.cookie + ';extra',
    'x'.repeat(10000),
  ]) {
    expect(exportSubject(key, token, undefined, now).hash).not.toBe(original.hash);
  }
});
it('登录主体不依赖匿名Cookie或设备，主体和日期之间隔离', () => {
  const first = exportSubject(key, undefined, 'account-1', now);
  expect(exportSubject(key, undefined, 'account-1', now).hash).toBe(first.hash);
  expect(exportSubject(key, undefined, 'account-2', now).hash).not.toBe(first.hash);
  expect(exportSubject(key, undefined, 'account-1', now + 86400_000).hash).not.toBe(first.hash);
  expect(exportSubject('abcdef0123456789'.repeat(4), first.cookie, 'account-1', now).hash).not.toBe(
    first.hash,
  );
});
