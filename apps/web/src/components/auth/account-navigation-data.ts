import type { UserRole } from '@personamarket/contracts';
import {
  BookmarkIcon,
  BellIcon,
  FlagIcon,
  LayoutDashboardIcon,
  UserRoundIcon,
  ShieldCheckIcon,
  MessageSquareIcon,
  UsersIcon,
  SettingsIcon,
  FolderTreeIcon,
  TagsIcon,
  MegaphoneIcon,
  BookOpenIcon,
  ActivityIcon,
  type LucideIcon,
} from 'lucide-react';

export type AccountNavigationItem = { label: string; href: string; icon: LucideIcon };
export type AccountNavigationGroup = {
  id: 'personal' | 'moderation' | 'operations' | 'system';
  label: string;
  icon: LucideIcon;
  items: AccountNavigationItem[];
};

export const accountRoleLabels: Record<UserRole, string> = {
  user: '角色创作者',
  moderator: '内容审核员',
  admin: '站点管理员',
};

export function accountNavigationGroups(
  role: UserRole,
  authenticated: boolean,
  username: string,
): AccountNavigationGroup[] {
  const personal: AccountNavigationGroup = {
    id: 'personal',
    label: '个人',
    icon: UserRoundIcon,
    items: authenticated
      ? [
          {
            label: '公开主页',
            href: '/users/' + encodeURIComponent(username),
            icon: UserRoundIcon,
          },
          { label: '个人资料', href: '/dashboard/profile', icon: UserRoundIcon },
          { label: '我的收藏', href: '/dashboard/favorites', icon: BookmarkIcon },
          { label: '我的通知', href: '/dashboard/notifications', icon: BellIcon },
          { label: '我的举报', href: '/dashboard/reports', icon: FlagIcon },
          { label: '创作工作台', href: '/dashboard/personas', icon: LayoutDashboardIcon },
          { label: '账号与安全', href: '/account', icon: UserRoundIcon },
        ]
      : [{ label: '账号与安全', href: '/mfa', icon: UserRoundIcon }],
  };
  const result = [personal];
  if (!authenticated || role === 'user') return result;
  result.push({
    id: 'moderation',
    label: '审核',
    icon: ShieldCheckIcon,
    items: [
      { label: '管理概览', href: '/admin', icon: LayoutDashboardIcon },
      { label: '内容审核', href: '/admin/moderation', icon: ShieldCheckIcon },
      { label: '评论审核', href: '/admin/comments', icon: MessageSquareIcon },
      { label: '资料审核', href: '/admin/profiles', icon: UserRoundIcon },
      ...(role === 'admin' ? [{ label: '举报处理', href: '/admin/reports', icon: FlagIcon }] : []),
    ],
  });
  if (role === 'admin')
    result.push(
      {
        id: 'operations',
        label: '运营',
        icon: LayoutDashboardIcon,
        items: [
          { label: '人设管理', href: '/admin/personas', icon: LayoutDashboardIcon },
          { label: '分类管理', href: '/admin/categories', icon: FolderTreeIcon },
          { label: '标签管理', href: '/admin/tags', icon: TagsIcon },
          { label: '公告管理', href: '/admin/announcements', icon: MegaphoneIcon },
          { label: '指南内容', href: '/admin/guides', icon: BookOpenIcon },
          { label: '通知管理', href: '/admin/notifications', icon: BellIcon },
        ],
      },
      {
        id: 'system',
        label: '系统',
        icon: SettingsIcon,
        items: [
          { label: '用户管理', href: '/admin/users', icon: UsersIcon },
          { label: '失败任务', href: '/admin/tasks', icon: ActivityIcon },
          { label: '站点设置', href: '/admin/settings/brand', icon: SettingsIcon },
        ],
      },
    );
  return result;
}
