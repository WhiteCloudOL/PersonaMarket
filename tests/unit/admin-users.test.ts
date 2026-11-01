import { describe, expect, it } from 'vitest';
import {
  AdminUserResponseSchema,
  AdminUsersQuerySchema,
  AdminDeactivationPathSchema,
  ReviewDeactivationRequestSchema,
  RevokeAdminUserSessionsSchema,
  SetAdminUserRoleSchema,
  SetAdminUserStatusSchema,
} from '@personamarket/contracts';

describe('管理员用户管理契约', () => {
  const write = { expectedSecurityVersion: 3, reason: '经核对处理账号' };
  it('默认仅处理账号，恢复账号不能隐含恢复作品或受控停用账号', () => {
    expect(SetAdminUserStatusSchema.parse({ ...write, status: 'banned' }).scope).toBe(
      'account_only',
    );
    expect(
      SetAdminUserStatusSchema.safeParse({
        ...write,
        status: 'active',
        scope: 'account_and_personas',
      }).success,
    ).toBe(false);
    expect(SetAdminUserStatusSchema.safeParse({ ...write, status: 'deactivated' }).success).toBe(
      false,
    );
  });
  it('关键操作必须有预期版本与非空理由，拒绝额外身份和密码字段', () => {
    expect(SetAdminUserRoleSchema.safeParse({ role: 'moderator' }).success).toBe(false);
    expect(SetAdminUserRoleSchema.safeParse({ ...write, role: 'owner' }).success).toBe(false);
    expect(SetAdminUserRoleSchema.safeParse({ ...write, role: 'user', reason: '  ' }).success).toBe(
      false,
    );
    expect(
      SetAdminUserRoleSchema.safeParse({ ...write, role: 'user', reason: '非法\0理由' }).success,
    ).toBe(false);
    expect(
      RevokeAdminUserSessionsSchema.safeParse({ ...write, currentPassword: '不应进入管理请求' })
        .success,
    ).toBe(false);
    expect(
      RevokeAdminUserSessionsSchema.safeParse({ ...write, expectedSecurityVersion: 0 }).success,
    ).toBe(false);
  });
  it('分页和排序有白名单，用户详情拒绝秘密字段', () => {
    expect(AdminUsersQuerySchema.parse({}).pageSize).toBe(20);
    expect(AdminUsersQuerySchema.safeParse({ page: 2501 }).success).toBe(false);
    expect(AdminUsersQuerySchema.safeParse({ pageSize: 21 }).success).toBe(false);
    expect(AdminUsersQuerySchema.safeParse({ q: '搜索\0文本' }).success).toBe(false);
    expect(AdminUsersQuerySchema.safeParse({ sort: 'email; DROP TABLE users' }).success).toBe(
      false,
    );
    const data = {
      id: 'ba0b19fa-3ad6-4bbf-98d5-256a918ed3e9',
      username: 'fixture_admin',
      role: 'admin',
      status: 'active',
      emailVerified: true,
      securityVersion: 3,
      personaCount: 0,
      activeSessionCount: 1,
      pendingDeactivation: false,
      createdAt: '2026-10-28T04:00:00.000Z',
      email: 'admin@fixture.invalid',
      mfaEnabled: true,
      updatedAt: '2026-10-28T04:00:00.000Z',
      records: [],
      deactivationRequests: [],
    };
    expect(AdminUserResponseSchema.safeParse({ data }).success).toBe(true);
    for (const forbidden of ['passwordHash', 'encryptedSecret', 'tokenHash', 'recoveryCodes'])
      expect(
        AdminUserResponseSchema.safeParse({ data: { ...data, [forbidden]: 'secret' } }).success,
      ).toBe(false);
  });
  it('停用审核绑定具体申请与账号版本，拒绝额外范围、身份和凭据', () => {
    expect(AdminUsersQuerySchema.parse({}).deactivation).toBe('all');
    expect(AdminUsersQuerySchema.parse({ deactivation: 'pending' }).deactivation).toBe('pending');
    expect(AdminUsersQuerySchema.safeParse({ deactivation: 'approved' }).success).toBe(false);
    expect(
      AdminDeactivationPathSchema.safeParse({
        id: 'ba0b19fa-3ad6-4bbf-98d5-256a918ed3e9',
        requestId: 'another-user-request',
      }).success,
    ).toBe(false);
    expect(ReviewDeactivationRequestSchema.parse({ ...write, decision: 'reject' })).toEqual({
      ...write,
      decision: 'reject',
    });
    for (const input of [
      { decision: 'approve' },
      { ...write, decision: 'withdraw' },
      { ...write, decision: 'approve', expectedSecurityVersion: 0 },
      { ...write, decision: 'approve', reason: ' \t\n' },
      { ...write, decision: 'approve', reason: '越界\0理由' },
      { ...write, decision: 'approve', reason: '字'.repeat(2001) },
      { ...write, decision: 'approve', scope: 'account_and_personas' },
      { ...write, decision: 'approve', actorId: 'forged' },
      { ...write, decision: 'approve', currentPassword: 'not-an-operation-field' },
    ])
      expect(ReviewDeactivationRequestSchema.safeParse(input).success).toBe(false);
    const original = '  本次处理理由\n保留首尾空白  ';
    expect(
      ReviewDeactivationRequestSchema.parse({ ...write, decision: 'approve', reason: original })
        .reason,
    ).toBe(original);
  });
});
