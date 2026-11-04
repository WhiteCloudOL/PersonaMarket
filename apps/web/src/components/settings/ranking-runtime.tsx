'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@personamarket/ui/components/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@personamarket/ui/components/collapsible';
import { rankingSettingsApi, rankingSettingsKey } from '@/lib/ranking-settings-api';
import { FormNotice } from '../auth/auth-fields';
import { RankingSettingsSummary } from './ranking-settings-summary';
import { announcementDate } from '../announcements/announcement-content';

export function RankingRuntime({
  accountId,
  expectedRevision,
}: {
  accountId: string;
  expectedRevision: number;
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: [...rankingSettingsKey(accountId), 'runtime'],
    queryFn: ({ signal }) => rankingSettingsApi.runtime(accountId, signal),
    retry: false,
    refetchInterval: (query) => {
      const result = query.state.data;
      if (
        query.state.status === 'error' ||
        result?.data.latestRequest?.status === 'failed' ||
        (result && result.meta.settingsRevision > expectedRevision)
      )
        return false;
      return result &&
        result.meta.settingsRevision === expectedRevision &&
        result.data.latestCompleted?.definition?.settingsRevision === expectedRevision &&
        result.data.latestRequest?.status === 'completed'
        ? false
        : 2000;
    },
  });
  if (query.isError)
    return (
      <div className="flex flex-col items-start gap-3">
        <FormNotice error={query.error} />
        <Button variant="outline" onClick={() => void query.refetch()}>
          重新核对批次状态
        </Button>
      </div>
    );
  if (!query.data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        正在读取实际榜单批次…
      </p>
    );
  const { latestCompleted: completed, latestRequest: requested } = query.data.data;
  const revision = query.data.meta.settingsRevision;
  const current =
    revision === expectedRevision && completed?.definition?.settingsRevision === expectedRevision;
  const summary =
    revision > expectedRevision
      ? '榜单配置已在其他窗口更新'
      : current
        ? '公开榜单已使用当前配置'
        : requested?.status === 'failed'
          ? '最近计算失败，公开榜单保留上次成功结果'
          : '公开榜单等待按当前配置计算';
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <p role="status" className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {summary}
        </p>
        <CollapsibleTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-h-11 max-w-full whitespace-normal"
            />
          }
        >
          {open ? '收起批次状态' : '查看批次状态'}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="pt-3">
        <section
          aria-label="实际榜单批次"
          className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground"
        >
          <h2 className="font-semibold text-foreground">实际榜单批次</h2>
          <p>
            {completed
              ? `最近成功：${completed.algorithm}${completed.definition ? '' : ' / 历史固定参数'}`
              : '尚无成功批次'}
          </p>
          {requested && (
            <p>
              最近请求：
              {requested.status === 'pending'
                ? '等待处理'
                : requested.status === 'failed'
                  ? '计算失败，尚未替换公开结果'
                  : '已完成'}{' '}
              · {announcementDate(requested.requestedAt)}
            </p>
          )}
          {completed?.definition ? (
            <RankingSettingsSummary value={completed.definition.settings} />
          ) : (
            <p>历史批次使用自身固定算法，今日设置不会回填到旧批次</p>
          )}
          {completed?.generatedAt && <p>成功时间 {announcementDate(completed.generatedAt)}</p>}
          {requested?.errorCode && <p className="break-all">失败标识 {requested.errorCode}</p>}
          <p>重建使用执行时可见的当前业务事实，不能精确还原任意历史时刻</p>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? '正在核对…' : '核对批次状态'}
          </Button>
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}
