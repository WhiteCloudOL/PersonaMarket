import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { z } from 'zod';
import {
  GuideSlugSchema,
  GuideFieldsSchema,
  GuideWriteSchema,
  GuideActionSchema,
  guideEtag,
} from '@personamarket/contracts';

it('九个原指南章节可转换为完整Markdown，保留平台版本和原生能力提示', () => {
  const rows = z
    .array(GuideFieldsSchema.extend({ slug: GuideSlugSchema, originalText: z.string() }))
    .parse(
      JSON.parse(readFileSync(new URL('../fixtures/guides-initial.json', import.meta.url), 'utf8')),
    );
  expect(rows.map((row) => row.slug)).toEqual(GuideSlugSchema.options);
  expect(rows.find((row) => row.slug === 'maibot')?.bodyMarkdown).toContain('1.3.15');
  const astrbot = rows.find((row) => row.slug === 'astrbot')?.bodyMarkdown;
  expect(astrbot).toContain('4.29.3');
  expect(astrbot).toContain('移除系统提示词首尾空白');
  expect(astrbot).toContain('Skills 默认设置');
});

it('指南限制固定章节、Unicode字数和控制字符，原始Markdown空白保持不变', () => {
  const input = {
    title: '使用指南',
    summary: '',
    bodyMarkdown: '  # 星光\n\n保留原始空白  ',
    reason: '核对\n发布范围',
  };
  expect(GuideWriteSchema.parse(input)).toEqual(input);
  expect(GuideFieldsSchema.safeParse({ ...input, reason: undefined }).success).toBe(false);
  expect(GuideSlugSchema.safeParse('license').success).toBe(false);
  expect(GuideSlugSchema.safeParse('../maibot').success).toBe(false);
  expect(GuideWriteSchema.safeParse({ ...input, title: '🌟'.repeat(160) }).success).toBe(true);
  expect(GuideWriteSchema.safeParse({ ...input, title: '🌟'.repeat(161) }).success).toBe(false);
  expect(GuideWriteSchema.safeParse({ ...input, bodyMarkdown: '\u0000' }).success).toBe(false);
  expect(GuideActionSchema.safeParse({ reason: '确认发布', confirmed: true }).success).toBe(true);
  expect(GuideActionSchema.safeParse({ reason: '确认发布' }).success).toBe(false);
  expect(guideEtag('maibot', 12)).toBe('"guide-maibot-12"');
});
