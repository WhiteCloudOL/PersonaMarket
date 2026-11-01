import { describe, expect, it } from 'vitest';
import {
  AdminPersonasQuerySchema,
  AdminPersonaResponseSchema,
  AdminPersonasResponseSchema,
} from '@personamarket/contracts';

describe('人设管理只读契约', () => {
  it('分页、筛选和排序有界且不接受身份或SQL字段', () => {
    expect(AdminPersonasQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 20,
      state: 'all',
    });
    expect(AdminPersonasQuerySchema.parse({ page: '2500', q: '  字面%_  ' }).q).toBe('字面%_');
    for (const input of [
      { page: 2501 },
      { page: 0 },
      { pageSize: 21 },
      { pageSize: 0 },
      { page: 1.5 },
      { ownerId: 'forged' },
      { categoryId: 'invalid' },
      { platform: 'other' },
      { state: 'deleted' },
      { sort: 'updated_at; DROP TABLE personas' },
      { q: '\0' },
      { q: '字'.repeat(161) },
      { role: 'administrator' },
    ])
      expect(AdminPersonasQuerySchema.safeParse(input).success).toBe(false);
  });

  const id = 'ba0b19fa-3ad6-4bbf-98d5-256a918ed3e9';
  const row = {
    id,
    owner: { id, username: 'metadata_owner', status: 'active' },
    platform: 'maibot',
    title: '',
    category: null,
    revision: 1,
    draftRevision: 1,
    ownerVisibility: 'listed',
    moderationState: 'normal',
    publiclyVisible: false,
    publishedReleaseId: null,
    pendingCount: 0,
    latestPendingSubmissionId: null,
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
  };
  it('允许空草稿元数据，拒绝私有正文、授权证据和账号秘密', () => {
    expect(AdminPersonaResponseSchema.parse({ data: row }).data.title).toBe('');
    for (const field of [
      'content',
      'payload',
      'readmeMarkdown',
      'authorizationEvidence',
      'requestId',
    ])
      expect(
        AdminPersonaResponseSchema.safeParse({ data: { ...row, [field]: '私有内容' } }).success,
      ).toBe(false);
    for (const field of ['email', 'passwordHash', 'encryptedSecret', 'role'])
      expect(
        AdminPersonaResponseSchema.safeParse({
          data: { ...row, owner: { ...row.owner, [field]: '私有内容' } },
        }).success,
      ).toBe(false);
  });
  it('分页响应最多20条，保留真实空页总数并拒绝负数和私密扩展', () => {
    const response = { data: [], meta: { page: 2, pageSize: 20, total: 21 } };
    expect(AdminPersonasResponseSchema.parse(response)).toEqual(response);
    expect(
      AdminPersonasResponseSchema.safeParse({
        ...response,
        data: Array.from({ length: 21 }, () => row),
      }).success,
    ).toBe(false);
    expect(
      AdminPersonasResponseSchema.safeParse({ ...response, meta: { ...response.meta, total: -1 } })
        .success,
    ).toBe(false);
    expect(AdminPersonasResponseSchema.safeParse({ ...response, sessionId: id }).success).toBe(
      false,
    );
  });
});
