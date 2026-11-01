import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { ReportSnapshotSchema, CreateReportSchema } from '@personamarket/contracts';

it('扩展资料举报后旧人设和评论证据的序列化哈希逐字节保持一致', () => {
  const context = {
    personaId: '11111111-1111-4111-8111-111111111111',
    releaseId: '22222222-2222-4222-8222-222222222222',
    version: '1.0.0',
    title: '旧举报证据',
    summary: '已公开说明',
    platform: 'maibot',
    author: { id: '33333333-3333-4333-8333-333333333333', username: 'legacy_author' },
  };
  const fixtures = [
    {
      snapshot: { type: 'persona', ...context },
      expected: '8e120e40140c8b8ddeef168c689e80ad6af499c2511b7fa83891c9fd6289b265',
    },
    {
      snapshot: {
        type: 'comment',
        ...context,
        comment: {
          id: '44444444-4444-4444-8444-444444444444',
          revisionId: '55555555-5555-4555-8555-555555555555',
          body: '旧公开评论\n保持原文',
        },
      },
      expected: 'cde79dd139e13e78c2a61f87cd507f349ace56d2aa71740e2e8b0e6c2caac04b',
    },
  ];
  for (const fixture of fixtures)
    expect(
      createHash('sha256')
        .update(JSON.stringify(ReportSnapshotSchema.parse(fixture.snapshot)))
        .digest('hex'),
    ).toBe(fixture.expected);
});

it('资料举报必须指定实际见到的获批快照，不能省略版本或混入其他目标字段', () => {
  const target = {
    type: 'profile',
    userId: '33333333-3333-4333-8333-333333333333',
    submissionId: '55555555-5555-4555-8555-555555555555',
  };
  expect(CreateReportSchema.safeParse({ target, reason: 'spam' }).success).toBe(true);
  expect(
    CreateReportSchema.safeParse({
      target: { type: target.type, userId: target.userId },
      reason: 'spam',
    }).success,
  ).toBe(false);
  expect(
    CreateReportSchema.safeParse({
      target: { ...target, personaId: target.userId },
      reason: 'spam',
    }).success,
  ).toBe(false);
});
