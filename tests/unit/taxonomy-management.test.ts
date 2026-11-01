import { expect, it } from 'vitest';
import {
  CreateTaxonomyEntrySchema,
  TaxonomyManagementQuerySchema,
  TaxonomyActionSchema,
  TaxonomyManagementRecordsResponseSchema,
} from '@personamarket/contracts';
const input = { name: '温柔的日常', active: true, sortOrder: 0, reason: '整理创作分类' };
it('分类标签输入保留真实名称，拒绝控制字符、模糊状态和客户端权限字段', () => {
  expect(CreateTaxonomyEntrySchema.parse(input)).toEqual(input);
  for (const value of [
    { ...input, name: ' 首尾空白' },
    { ...input, name: '名字\n换行' },
    { ...input, name: '🌟'.repeat(81) },
    { ...input, role: 'admin' },
    { ...input, active: 'true' },
    { ...input, sortOrder: 10001 },
    { ...input, reason: ' \n ' },
  ])
    expect(CreateTaxonomyEntrySchema.safeParse(value).success).toBe(false);
  expect(CreateTaxonomyEntrySchema.parse({ ...input, name: '🌟'.repeat(80) }).name).toBe(
    '🌟'.repeat(80),
  );
});
it('管理查询和归档请求有明确范围，记录不接受私有请求字段', () => {
  expect(TaxonomyManagementQuerySchema.parse({})).toEqual({
    q: '',
    state: 'all',
    page: 1,
    pageSize: 20,
  });
  for (const value of [
    { page: 0 },
    { page: 51 },
    { pageSize: 21 },
    { state: 'deleted' },
    { q: '\u0000' },
  ])
    expect(TaxonomyManagementQuerySchema.safeParse(value).success).toBe(false);
  expect(TaxonomyActionSchema.safeParse({ reason: '说明\u0000' }).success).toBe(false);
  expect(TaxonomyActionSchema.parse({ reason: ' 原因\n保留原文 ' }).reason).toBe(
    ' 原因\n保留原文 ',
  );
  expect(
    TaxonomyManagementRecordsResponseSchema.safeParse({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
      requestId: 'private',
    }).success,
  ).toBe(false);
});
