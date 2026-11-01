import { describe, expect, it } from 'vitest';
import {
  CreationSettingsUpdateSchema,
  CreationSettingsWriteSchema,
  CreationSettingsResponseSchema,
  SubmissionPendingHintSchema,
  SubmissionPendingHintResponseSchema,
  SubmissionSettingsRecordsQuerySchema,
  SubmissionSettingsRecordValueSchema,
  defaultCreationSettings,
  defaultSubmissionPendingHint,
} from '@personamarket/contracts';

describe('投稿待审提示契约', () => {
  it('默认值保持既有投稿和内容限制，并提供明确待审说明', () => {
    const data = CreationSettingsResponseSchema.parse({
      data: defaultCreationSettings,
      defaults: defaultCreationSettings,
      meta: { contentLimits: 1, submissions: 1 },
    });
    expect(data.data.submissions).toEqual({
      enabled: true,
      platforms: ['maibot', 'astrbot'],
      dailyQuota: 20,
      pendingHint: defaultSubmissionPendingHint,
    });
    const invalid = CreationSettingsWriteSchema.safeParse({
      data: {
        ...defaultCreationSettings,
        submissions: { ...defaultCreationSettings.submissions, platforms: [] },
      },
      reason: '核对平台字段校验',
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success)
      expect(invalid.error.issues.map((issue) => issue.message)).toContain(
        '请至少选择一个投稿平台',
      );
  });
  it('按code point计算500字符，允许换行但不接受其他控制字符', () => {
    expect(SubmissionPendingHintSchema.safeParse('🌟'.repeat(500)).success).toBe(true);
    expect(SubmissionPendingHintSchema.safeParse('🌟'.repeat(501)).success).toBe(false);
    expect(SubmissionPendingHintSchema.parse('第一行\n第二行\t补充\r\n保留空白')).toBe(
      '第一行\n第二行\t补充\r\n保留空白',
    );
    expect(SubmissionPendingHintSchema.safeParse('说明\u0000文字').success).toBe(false);
  });
  it('空串隐藏额外提示，纯空白无效，纯文本不改写作者输入', () => {
    expect(SubmissionPendingHintSchema.parse('')).toBe('');
    expect(SubmissionPendingHintSchema.safeParse(' \t\n').success).toBe(false);
    expect(SubmissionPendingHintSchema.parse('  **请继续编辑**\n保留格式符号  ')).toBe(
      '  **请继续编辑**\n保留格式符号  ',
    );
  });
  it('旧PATCH省略新字段不会注入默认值，显式空串仍保留', () => {
    const legacy = { enabled: false, platforms: ['maibot'], dailyQuota: 8 };
    const input = {
      data: { ...defaultCreationSettings, submissions: legacy },
      expected: { contentLimits: 2, submissions: 3 },
    };
    expect(CreationSettingsUpdateSchema.parse(input).data.submissions.pendingHint).toBeUndefined();
    expect(CreationSettingsUpdateSchema.parse(input).reason).toBe('更新创作与投稿设置');
    expect(
      CreationSettingsUpdateSchema.parse({
        ...input,
        data: { ...input.data, submissions: { ...legacy, pendingHint: '' } },
      }).data.submissions.pendingHint,
    ).toBe('');
    expect(
      CreationSettingsWriteSchema.safeParse({ data: input.data, reason: '新表单必须提供完整候选' })
        .success,
    ).toBe(false);
  });
  it('创作者DTO只包含当前提交标识、提示与设置修订', () => {
    const result = {
      data: {
        submissionId: '45970848-4ca6-4ef6-9ea0-b80a5f6fbffb',
        pendingHint: '等待处理期间仍可编辑',
      },
      meta: { settingsRevision: 7 },
    };
    expect(SubmissionPendingHintResponseSchema.parse(result)).toEqual(result);
    expect(
      SubmissionPendingHintResponseSchema.safeParse({
        ...result,
        data: { ...result.data, dailyQuota: 20 },
      }).success,
    ).toBe(false);
    expect(
      SubmissionPendingHintResponseSchema.safeParse({ ...result, meta: { settingsRevision: 0 } })
        .success,
    ).toBe(false);
  });
  it('历史可明确表示字段当时不存在，分页保持固定范围', () => {
    const old = SubmissionSettingsRecordValueSchema.parse({
      ...defaultCreationSettings.submissions,
      pendingHint: null,
    });
    expect(old.pendingHint).toBeNull();
    expect(SubmissionSettingsRecordsQuerySchema.parse({})).toEqual({ page: 1 });
    for (const page of [0, 101, 1.5])
      expect(SubmissionSettingsRecordsQuerySchema.safeParse({ page }).success).toBe(false);
    expect(SubmissionSettingsRecordsQuerySchema.safeParse({ page: 1, group: 'mail' }).success).toBe(
      false,
    );
  });
});
