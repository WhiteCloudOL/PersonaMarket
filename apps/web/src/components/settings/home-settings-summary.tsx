import type { HomeSettings, HomeSectionKey, OptionalNavigationKey } from '@personamarket/contracts';
import { Badge } from '@personamarket/ui/components/badge';

export const homeSectionLabels = {
  featured: '精选人设',
  recent: '新近发布',
  announcements: '站点公告',
  creation: '创作入口',
} satisfies Record<HomeSectionKey, string>;
export const optionalNavigationLabels = {
  rankings: '人设排行',
  publish: '发布作品',
  guides: '使用指南',
  announcements: '站点公告',
} satisfies Record<OptionalNavigationKey, string>;

export function HomeSettingsSummary({ value }: { value: HomeSettings }) {
  return (
    <dl className="grid min-w-0 gap-4 text-sm">
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="font-medium">首页短提示</dt>
        <dd className="text-muted-foreground [overflow-wrap:anywhere]">{value.heroNote}</dd>
      </div>
      <div className="flex flex-col gap-2">
        <dt className="font-medium">模块展示顺序</dt>
        <dd>
          <ol className="flex flex-col gap-2">
            {value.sections.map((section, index) => (
              <li key={section.key} className="flex flex-wrap items-center gap-2">
                <span>
                  {index + 1} · {homeSectionLabels[section.key]}
                </span>
                <Badge variant={section.enabled ? 'secondary' : 'outline'}>
                  {section.enabled ? '展示' : '收起'}
                </Badge>
              </li>
            ))}
          </ol>
        </dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="font-medium">展示数量上限</dt>
        <dd className="text-muted-foreground">
          精选 {value.featuredCount} · 新作 {value.recentCount} · 公告 {value.announcementCount}
        </dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="font-medium">主导航</dt>
        <dd className="text-muted-foreground [overflow-wrap:anywhere]">
          {['首页', '探索', ...value.navigation.map((key) => optionalNavigationLabels[key])].join(
            '、',
          )}
        </dd>
      </div>
    </dl>
  );
}
