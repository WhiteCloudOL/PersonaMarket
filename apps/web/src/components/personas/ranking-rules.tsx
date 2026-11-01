'use client';
import { CircleHelpIcon } from 'lucide-react';
import { useClientReady } from '@/hooks/use-client-ready';
import { Button } from '@personamarket/ui/components/button';
import { INTERACTION_RANKING_WEIGHTS, type RankingListResponse } from '@personamarket/contracts';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from '@personamarket/ui/components/sheet';

export function RankingRules({
  title = '这份榜单如何计算',
  closeLabel = '返回榜单',
  meta,
}: {
  title?: string;
  closeLabel?: string;
  meta?: RankingListResponse['meta'];
}) {
  const hydrated = useClientReady();
  const weights = meta?.definition?.settings.weights ?? INTERACTION_RANKING_WEIGHTS;
  return (
    <Sheet>
      <SheetTrigger
        disabled={!hydrated}
        render={<Button type="button" variant="ghost" className="shrink-0" />}
      >
        <CircleHelpIcon aria-hidden data-icon="inline-start" />
        统计说明
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 overflow-hidden pb-0 sm:max-w-lg">
        <SheetHeader className="border-b p-5 pr-16">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>统计真实有效互动和导出，保留旧版快照口径</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-6 text-base leading-7 text-muted-foreground">
          <p>
            {meta
              ? `本批算法 ${meta.algorithm}${meta.definition ? ' · 设置修订 ' + meta.definition.settingsRevision : ' · 历史固定参数'}`
              : '探索页即时热度 · interactions-v1 固定参数'}
          </p>
          <p>
            <strong className="text-foreground">热门</strong> ·
            {meta?.algorithm === 'exports-v1'
              ? '近 7 天有效导出按 7 天半衰期衰减，不计点赞收藏'
              : `近7×24小时有效点赞×${weights.likes}、收藏×${weights.favorites}、导出×${weights.exports}，按首次事实的时间衰减，7 天半衰期让近期互动更有分量`}
          </p>
          <p>
            <strong className="text-foreground">点赞和收藏</strong> ·
            近7天、近30天按滚动24小时统计，总榜统计当前有效关系；取消重加保留首次时间，不会刷新成新增互动
          </p>
          <p>
            关系必须来自正常且邮箱已验证的账号，作者本人不计入排行；页面总数包含本人互动，可能与排行有效数量不同，收藏者身份始终私有
          </p>
          <p>
            <strong className="text-foreground">旧版快照</strong> · exports-v1：近 7
            天的有效导出按时间衰减，不计点赞收藏；以本批版本标记为准
          </p>
          <p>
            <strong className="text-foreground">下载</strong> · 同一主体、同一人设在一个 UTC
            日期内跨格式、跨版本最多计一次，作者本人不计入排名，匿名去重为近似统计
          </p>
          <p>
            <strong className="text-foreground">新作与更新</strong> ·
            新作看首次公开时间，补丁保留首次时间；更新榜看当前公开版本
            {meta?.kind === 'new' && meta.windowDays ? `；本批新作窗口 ${meta.windowDays} 天` : ''}
          </p>
          {meta ? (
            <>
              <p>
                本批约每 {meta.definition?.settings.refreshMinutes ?? 5}{' '}
                分钟安排刷新，隐藏和下架状态会在读取时即时过滤，每个榜单最多展示 {meta.entryLimit}{' '}
                项
              </p>
              <p>
                分数在本批生成时固定，新增、取消和账号状态变化在下一批计算中体现；旧批次不会使用今天的运营设置重新解释
              </p>
            </>
          ) : (
            <p>探索热度按读取时的有效事实计算，独立于排行运营参数，隐藏和下架状态会即时过滤</p>
          )}
          <p>有效导出仅表示服务端提供了文件响应，保存或安装需在目标平台确认</p>
        </div>
        <SheetFooter className="shrink-0 border-t px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetClose
            render={
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-11 whitespace-normal"
              />
            }
          >
            {closeLabel}
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
