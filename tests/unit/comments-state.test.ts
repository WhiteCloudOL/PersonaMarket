import { expect, it } from 'vitest';
import { retainsCommentDraft } from '../../apps/web/src/lib/comments-state.js';

const documentIdentity = {
  personaId: '3cabba2c-340d-4edb-8357-a1404f6f878a',
  releaseId: '8c248fec-d511-4e8c-a1bf-a66a05c1e532',
};
const alias = new URL(
  'https://example.invalid/personas/' + documentIdentity.personaId + '?commentsPage=1',
);
const chapter = new URL(
  'https://example.invalid/personas/' +
    documentIdentity.personaId +
    '/releases/' +
    documentIdentity.releaseId +
    '?commentsPage=1#pm-readme-' +
    documentIdentity.releaseId +
    '-128',
);

it('带明确身份的同一已加载Release章节地址保留草稿，缺少身份时仍需确认', () => {
  expect(retainsCommentDraft(chapter, alias, documentIdentity)).toBe(true);
  expect(retainsCommentDraft(chapter, alias)).toBe(false);
});

it.each([
  ['站外链接', chapter.href.replace('example.invalid', 'elsewhere.invalid')],
  [
    '其他作品',
    chapter.href.replace(documentIdentity.personaId, '46f97298-c7b4-4fe8-8402-e50d632d73d5'),
  ],
  [
    '其他版本',
    chapter.href.replaceAll(documentIdentity.releaseId, '46f97298-c7b4-4fe8-8402-e50d632d73d5'),
  ],
  [
    '其他锚点',
    chapter.href.replace('#pm-readme-' + documentIdentity.releaseId + '-128', '#comment-composer'),
  ],
  ['无效位置', chapter.href.replace('-128', '-not-an-offset')],
  ['额外业务条件', chapter.href.replace('?commentsPage=1', '?other=changed')],
])('%s不能借章节地址绕过离开保护', (_name, address) => {
  expect(retainsCommentDraft(new URL(address), alias, documentIdentity)).toBe(false);
});

const current = new URL('https://personas.example/personas/example?version=1.0.0#my-comments');

it('同一作品内的评论、本人记录、回复翻页和排序保留内存草稿', () => {
  for (const [name, value] of [
    ['commentsPage', '2'],
    ['myCommentsPage', '3'],
    ['repliesPage', '2'],
    ['replyThread', 'root-id'],
    ['commentsSort', 'newest'],
  ]) {
    if (!name || !value) throw new Error('缺少评论导航参数');
    const target = new URL(current);
    target.searchParams.set(name, value);
    target.hash = 'comments';
    expect(retainsCommentDraft(target, current)).toBe(true);
  }
});

it('版本或其他页面参数改变时保留离开确认', () => {
  for (const search of ['?version=2.0.0', '?version=1.0.0&preview=true', '?commentsPage=2']) {
    const target = new URL(current);
    target.search = search;
    expect(retainsCommentDraft(target, current)).toBe(false);
  }
});

it('不同作品或外部同路径地址不能绕过离开确认', () => {
  for (const target of [
    new URL('https://personas.example/personas/other?version=1.0.0'),
    new URL('https://outside.example/personas/example?version=1.0.0'),
    new URL('https://personas.example/'),
  ])
    expect(retainsCommentDraft(target, current)).toBe(false);
});
