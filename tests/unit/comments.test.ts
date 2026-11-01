import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BulkReviewCommentsSchema,
  CommentBodySchema,
  CommentSettingsSchema,
  CreateCommentSchema,
  PublicCommentSchema,
  ReviewCommentSchema,
  defaultCommentSettings,
} from '@personamarket/contracts';

describe('评论契约与公开边界', () => {
  it('按 Unicode code point 限长，保留空白和换行，拒绝空白及控制字符', () => {
    const body = '  第一行\r\n\t第二行 😀  ';
    expect(CommentBodySchema.parse(body)).toBe(body);
    expect(CommentBodySchema.safeParse('😀'.repeat(2000)).success).toBe(true);
    for (const invalid of ['', ' \t\r\n ', '😀'.repeat(2001), '正文\0后文', '正文\u0007'])
      expect(CommentBodySchema.safeParse(invalid).success).toBe(false);
    expect(CommentBodySchema.parse('<script>alert(1)</script>')).toContain('<script>');
  });
  it('公开占位不携带隐藏正文、作者、待审快照或审核理由', () => {
    const deleted = {
      id: randomUUID(),
      personaId: randomUUID(),
      parentId: null,
      replyTo: null,
      release: null,
      createdAt: new Date().toISOString(),
      replyCount: 2,
      status: 'deleted',
    };
    expect(PublicCommentSchema.safeParse(deleted).success).toBe(true);
    for (const field of ['body', 'author', 'latest', 'reason'])
      expect(PublicCommentSchema.safeParse({ ...deleted, [field]: 'private' }).success).toBe(false);
    expect(CreateCommentSchema.safeParse({ body: '评论', authorId: randomUUID() }).success).toBe(
      false,
    );
  });
  it('审核绑定具体文本与期望修订，驳回理由必填，批量拒绝重复或超限目标', () => {
    const review = { revisionId: randomUUID(), expectedRevision: 1, decision: 'approve' };
    expect(ReviewCommentSchema.safeParse(review).success).toBe(true);
    expect(ReviewCommentSchema.safeParse({ ...review, decision: 'reject' }).success).toBe(false);
    expect(
      ReviewCommentSchema.safeParse({ ...review, decision: 'reject', reason: ' 请补充上下文 ' })
        .success,
    ).toBe(true);
    const item = { id: randomUUID(), review };
    expect(BulkReviewCommentsSchema.safeParse({ items: [item, item] }).success).toBe(false);
    expect(
      BulkReviewCommentsSchema.safeParse({
        items: Array.from({ length: 21 }, () => ({ ...item, id: randomUUID() })),
      }).success,
    ).toBe(false);
    expect(ReviewCommentSchema.safeParse({ ...review, expectedRevision: 0 }).success).toBe(false);
  });
  it('默认全审且读写开关独立，拒绝没有实现的审核策略与无界字数频率', () => {
    expect(CommentSettingsSchema.parse(defaultCommentSettings).commentReviewMode).toBe('all');
    expect(
      CommentSettingsSchema.safeParse({
        ...defaultCommentSettings,
        commentsEnabled: false,
        showExistingComments: true,
      }).success,
    ).toBe(true);
    for (const invalid of [
      { commentReviewMode: 'new_users' },
      { commentMaxLength: 2001 },
      { commentsPerMinute: 0 },
      { commentsPerMinute: 31 },
    ])
      expect(
        CommentSettingsSchema.safeParse({ ...defaultCommentSettings, ...invalid }).success,
      ).toBe(false);
  });
});
