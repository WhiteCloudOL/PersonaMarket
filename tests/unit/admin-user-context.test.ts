import { describe, expect, it } from 'vitest';
import {
  AdminUserContentQuerySchema,
  AdminUserPublicPersonasResponseSchema,
  AdminUserReviewRecordsQuerySchema,
  AdminUserReviewRecordsResponseSchema,
} from '@personamarket/contracts';

describe('用户作品与审核记录契约', () => {
  it('分页与记录类别严格白名单，拒绝身份和SQL字段', () => {
    expect(AdminUserContentQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(AdminUserReviewRecordsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      kind: 'all',
    });
    expect(AdminUserReviewRecordsQuerySchema.parse({ page: '2', kind: 'comment' }).page).toBe(2);
    for (const value of [
      { page: 0 },
      { page: 501 },
      { pageSize: 21 },
      { pageSize: 0 },
      { page: 1.5 },
      { ownerId: 'forged' },
      { kind: 'passwords' },
      { sort: 'created_at;DROP TABLE users' },
    ])
      expect(AdminUserReviewRecordsQuerySchema.safeParse(value).success).toBe(false);
  });
  it('审核记录明确资源类型且拒绝正文与秘密，保留完整理由和系统处理人', () => {
    const id = 'ba0b19fa-3ad6-4bbf-98d5-256a918ed3e9';
    const common = {
      id,
      personaId: id,
      actor: null,
      action: 'auto_approve',
      reason: '  原始理由\n保留空白  ',
      selfReview: false,
      createdAt: '2026-10-28T10:00:00.000Z',
    };
    const comment = { ...common, kind: 'comment', commentId: id, revisionId: null };
    const wrap = (value: unknown) => ({ data: [value], meta: { page: 1, pageSize: 20, total: 1 } });
    expect(AdminUserReviewRecordsResponseSchema.parse(wrap(comment)).data[0]?.reason).toBe(
      common.reason,
    );
    for (const field of ['body', 'passwordHash', 'email', 'requestId', 'encryptedSecret'])
      expect(
        AdminUserReviewRecordsResponseSchema.safeParse(wrap({ ...comment, [field]: '私密数据' }))
          .success,
      ).toBe(false);
    expect(
      AdminUserReviewRecordsResponseSchema.safeParse(
        wrap({ ...comment, reason: '字'.repeat(2001) }),
      ).success,
    ).toBe(false);
    const persona = { ...common, kind: 'persona', submissionId: id, reason: '字'.repeat(5000) };
    expect(AdminUserReviewRecordsResponseSchema.parse(wrap(persona)).data[0]?.reason).toHaveLength(
      5000,
    );
    expect(
      AdminUserReviewRecordsResponseSchema.safeParse(
        wrap({ ...persona, reason: '字'.repeat(5001) }),
      ).success,
    ).toBe(false);
  });
  it('公开作品列表保留有限分页和真实总数，不接受搜索截断标记或内部信息', () => {
    const response = { data: [], meta: { page: 1, pageSize: 20, total: 0, capped: false } };
    expect(AdminUserPublicPersonasResponseSchema.parse(response)).toEqual(response);
    for (const meta of [
      { ...response.meta, total: -1 },
      { ...response.meta, pageSize: 21 },
      { ...response.meta, capped: true },
      { ...response.meta, passwordHash: 'secret' },
    ])
      expect(AdminUserPublicPersonasResponseSchema.safeParse({ ...response, meta }).success).toBe(
        false,
      );
  });
});
