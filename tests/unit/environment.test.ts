import { describe, expect, it } from 'vitest';
import { parseServerEnvironment, webEnvironment } from '@personamarket/server';
import { testEnvironment } from '../fixtures/environment.js';

describe('环境与秘密边界', () => {
  it('缺少凭据立即失败，错误不包含原始秘密', () => {
    const env = { ...testEnvironment(), DATABASE_URL: 'sensitive-invalid-value' };
    expect(() => parseServerEnvironment(env)).toThrow('DATABASE_URL');
    expect(() => parseServerEnvironment(env)).not.toThrow('sensitive-invalid-value');
  });
  it('禁止生产使用明文公网 origin、弱凭据和示例密钥', () => {
    expect(() => parseServerEnvironment({ ...testEnvironment(), NODE_ENV: 'production' })).toThrow(
      '环境配置无效',
    );
  });
  it('Web 子进程不接收数据库、Redis、会话或加密秘密', () => {
    const env = {
      ...testEnvironment(),
      MIGRATION_DATABASE_URL: 'private-admin-value',
      PATH: '/usr/bin',
      SESSION_SECRET: 'private-session',
      TRUST_PROXY_HOPS: '1',
    };
    const web = webEnvironment(env);
    expect(web).toEqual({
      NODE_ENV: 'test',
      PUBLIC_ORIGIN: env.PUBLIC_ORIGIN,
      API_INTERNAL_ORIGIN: env.API_INTERNAL_ORIGIN,
      TRUST_PROXY_HOPS: '1',
      PATH: '/usr/bin',
    });
  });
  it('API / Worker 环境剥离迁移所有者与测试数据库凭据', () => {
    const env = parseServerEnvironment({
      ...testEnvironment(),
      MIGRATION_DATABASE_URL: 'private-owner-credentials',
      TEST_DATABASE_URL: 'private-test-credentials',
    });
    expect(env).not.toHaveProperty('MIGRATION_DATABASE_URL');
    expect(env).not.toHaveProperty('TEST_DATABASE_URL');
  });
});
