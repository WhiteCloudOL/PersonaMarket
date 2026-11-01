import { expect, it } from 'vitest';
import { accountNavigationGroups } from '../../apps/web/src/components/auth/account-navigation-data.js';

it('普通用户从个人分组进入自己的举报，不显示管理入口', () => {
  const groups = accountNavigationGroups('user', true, 'nav_creator');
  expect(groups.map((group) => group.id)).toEqual(['personal']);
  expect(groups[0]?.items.map((item) => item.href)).toEqual(
    expect.arrayContaining([
      '/users/nav_creator',
      '/dashboard/favorites',
      '/dashboard/profile',
      '/dashboard/reports',
      '/dashboard/notifications',
      '/dashboard/personas',
      '/account',
    ]),
  );
  expect(
    groups.flatMap((group) => group.items).some((item) => item.href.startsWith('/admin')),
  ).toBe(false);
});

it('审核员保留内容和评论审核，举报管理仅对管理员显示', () => {
  const groups = accountNavigationGroups('moderator', true, 'nav_moderator');
  expect(
    groups.flatMap((group) => group.items).some((item) => item.href === '/dashboard/reports'),
  ).toBe(true);
  expect(groups.find((group) => group.id === 'moderation')?.items.map((item) => item.href)).toEqual(
    ['/admin', '/admin/moderation', '/admin/comments', '/admin/profiles'],
  );
  expect(
    groups.flatMap((group) => group.items).some((item) => item.href === '/admin/reports'),
  ).toBe(false);
});

it('管理员在审核分组进入举报，既有运营和系统入口完整保留', () => {
  const groups = accountNavigationGroups('admin', true, 'nav_admin');
  expect(groups.find((group) => group.id === 'moderation')?.items.map((item) => item.href)).toEqual(
    ['/admin', '/admin/moderation', '/admin/comments', '/admin/profiles', '/admin/reports'],
  );
  expect(groups.find((group) => group.id === 'operations')?.items.map((item) => item.href)).toEqual(
    [
      '/admin/personas',
      '/admin/categories',
      '/admin/tags',
      '/admin/announcements',
      '/admin/guides',
      '/admin/notifications',
    ],
  );
  expect(groups.find((group) => group.id === 'system')?.items.map((item) => item.href)).toEqual([
    '/admin/users',
    '/admin/tasks',
    '/admin/settings/brand',
  ]);
});

it('待完成登录MFA的受限管理员不暴露私有或管理导航', () => {
  expect(
    accountNavigationGroups('admin', false, 'nav_admin').map((group) => ({
      id: group.id,
      hrefs: group.items.map((item) => item.href),
    })),
  ).toEqual([{ id: 'personal', hrefs: ['/mfa'] }]);
});
