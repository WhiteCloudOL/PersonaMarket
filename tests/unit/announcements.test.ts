import { expect, it } from 'vitest';
import {
  AnnouncementActionSchema,
  AnnouncementWriteSchema,
  AdminAnnouncementsQuerySchema,
  PublicAnnouncementSummarySchema,
  announcementEtag,
} from '@personamarket/contracts';
const input = {
  title: '创作公告',
  summary: '一起分享灵感',
  body: ' 正文\n保留换行和空白 ',
  pinned: false,
  reason: '补充站点说明',
};
it('公告编辑内容保留原文，以Unicode字符计数并拒绝控制字符和客户端权限字段', () => {
  expect(AnnouncementWriteSchema.parse(input)).toEqual(input);
  for (const invalid of [
    { ...input, title: ' 首尾空白' },
    { ...input, title: '多行\n标题' },
    { ...input, body: '正文\u0000' },
    { ...input, body: ' ' },
    { ...input, body: '🌟'.repeat(20001) },
    { ...input, published: true },
    { ...input, status: 'published' },
  ])
    expect(AnnouncementWriteSchema.safeParse(invalid).success).toBe(false);
  expect(AnnouncementWriteSchema.parse({ ...input, body: '🌟'.repeat(20000) }).body).toBe(
    '🌟'.repeat(20000),
  );
});
it('发布状态变化需要明确确认和理由，分页范围与资源修订明确', () => {
  expect(AnnouncementActionSchema.safeParse({ reason: '发布' }).success).toBe(false);
  expect(AnnouncementActionSchema.safeParse({ reason: '发布', confirmed: false }).success).toBe(
    false,
  );
  expect(
    AnnouncementActionSchema.parse({ reason: ' 原文理由\n保留 ', confirmed: true }).reason,
  ).toBe(' 原文理由\n保留 ');
  for (const invalid of [
    { page: 101 },
    { pageSize: 21 },
    { status: 'deleted' },
    { q: '非法\u0000' },
  ])
    expect(AdminAnnouncementsQuerySchema.safeParse(invalid).success).toBe(false);
  expect(announcementEtag('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', 1)).toBe(
    '"announcement-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-1"',
  );
});
it('公开列表不接受编辑稿元数据或正文，明确区分公开摘要和详情', () => {
  const summary = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: '公开公告',
    summary: '',
    pinned: false,
    firstPublishedAt: '2026-10-29T00:00:00.000Z',
    publishedAt: '2026-10-29T00:00:00.000Z',
  };
  expect(PublicAnnouncementSummarySchema.parse(summary)).toEqual(summary);
  for (const extra of [
    { body: '正文' },
    { revision: 2 },
    { updatedBy: 'private' },
    { hasUnpublishedChanges: true },
  ])
    expect(PublicAnnouncementSummarySchema.safeParse({ ...summary, ...extra }).success).toBe(false);
});
