'use client';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdminRankingGeneration } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { rankingTaskApi } from '@/lib/ranking-task-api';
import { adminTaskApi } from '@/lib/admin-tasks-api';
import { FormNotice } from '../auth/auth-fields';
import { notificationAttemptText, notificationTimestamp } from '../notifications/delivery-state';
import { useTaskCommand } from './use-task-command';
import { TaskCommandForm } from './task-command-form';
import { RetryHistory, RetryHistoryError } from './retry-history';

const blockedText = {
  COMPLETED: '已有完成记录，不再创建新轮次',
  AUTO_RETRY_PENDING: '自动重试尚未结束，请稍后核对',
  DISPATCH_LEASE_ACTIVE: '原事件仍在分发处理中',
  CURRENT_EVENT_UNVERIFIABLE: '当前事件与轮次关联无法核验',
  LEGACY_TERMINAL_UNVERIFIABLE: '旧批次缺少可靠的终态证据',
  DEFINITION_UNVERIFIABLE: '原批次冻结定义无法核验',
  RESULT_INCONSISTENT: '现有结果不完整或与批次不一致，暂不能自动恢复',
  MANUAL_LIMIT_REACHED: '已达到三轮人工重试上限',
  COOLDOWN_ACTIVE: '仍在六十秒冷却期，请稍后核对',
} satisfies Record<NonNullable<AdminRankingGeneration['retry']['blockedReason']>, string>;
export function RankingRetryPanel({
  accountId,
  id,
  active,
  onPendingChange,
}: {
  accountId: string;
  id: string;
  active: boolean;
  onPendingChange: (value: boolean) => void;
}) {
  const latest = useRef<HTMLButtonElement>(null),
    [settled, setSettled] = useState(0),
    [historyOpen, setHistoryOpen] = useState(false);
  const query = useQuery({
    queryKey: ['private', 'ranking-task', accountId, id],
    queryFn: ({ signal }) => rankingTaskApi.detail(accountId, id, signal),
    enabled: active,
    retry: false,
    staleTime: 0,
  });
  const current = query.isError || query.isFetching ? undefined : query.data?.data;
  const target = { kind: 'ranking' as const, id };
  const flow = useTaskCommand(
    accountId,
    target,
    () => void query.refetch(),
    () => setSettled((value) => value + 1),
    onPendingChange,
  );
  const history = useQuery({
    queryKey: ['private', 'admin-task-retries', accountId, 'ranking', id],
    queryFn: ({ signal }) => adminTaskApi.history(accountId, { source: 'ranking', id }, signal),
    enabled: active && historyOpen,
    retry: false,
    staleTime: 0,
  });
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Button
        ref={latest}
        variant="outline"
        disabled={flow.busy}
        aria-busy={query.isFetching}
        onClick={() => {
          if (!query.isFetching) void query.refetch();
        }}
      >
        核对当前任务状态
      </Button>
      {query.isPending || query.isFetching ? (
        <Skeleton aria-label="正在核对榜单生成状态" className="h-40 w-full" />
      ) : query.isError ? (
        <FormNotice error={query.error} />
      ) : (
        current && (
          <>
            <RankingStatus value={current} />
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{current.algorithm}</Badge>
              <span className="text-sm text-muted-foreground">
                原设置修订 {current.settingsRevision ?? '旧算法无配置修订'}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              本次观测：
              {query.data?.meta.observedAt
                ? notificationTimestamp(query.data.meta.observedAt)
                : '未记录'}
            </p>
            {current.retry.blockedReason && (
              <p role="status" className="text-sm leading-6 text-muted-foreground">
                {blockedText[current.retry.blockedReason]}
                {current.retry.nextAllowedAt
                  ? '；下次可核对时间：' + notificationTimestamp(current.retry.nextAllowedAt)
                  : ''}
                {flow.draft?.command ? '。原请求回执仍可单独核对。' : '。'}
              </p>
            )}
            <p className="text-sm leading-6 text-muted-foreground">
              恢复同一批次，保留原算法和冻结定义；不会用今天的配置重建另一个批次。人工重试{' '}
              {current.retry.recordedManualRound} / {current.retry.maxManualRounds} 轮，每轮至少间隔{' '}
              {current.retry.cooldownSeconds} 秒。
            </p>
          </>
        )
      )}
      <TaskCommandForm
        flow={flow}
        target={target}
        version={current?.version}
        eligible={Boolean(current?.retry.allowed)}
        settled={settled}
        latest={latest}
      />
      {current && (
        <Collapsible className="min-w-0">
          <CollapsibleTrigger
            render={<Button variant="ghost" />}
            className="h-auto min-h-11 whitespace-normal"
          >
            查看原算法、轮次与技术详情
          </CollapsibleTrigger>
          <CollapsibleContent>
            <dl className="grid min-w-0 gap-4 py-4 sm:grid-cols-2">
              <Fact label="原批次" value={current.id} />
              <Fact label="原请求时间" value={notificationTimestamp(current.requestedAt)} />
              <Fact
                label="业务完成时间"
                value={
                  current.generatedAt ? notificationTimestamp(current.generatedAt) : '尚未记录'
                }
              />
              <Fact label="当前事件" value={current.run?.eventId ?? '旧批次尚未建立轮次台账'} />
              <Fact
                label="分发尝试"
                value={notificationAttemptText(
                  current.run?.dispatchAttempts ?? current.legacy?.dispatchAttempts ?? null,
                )}
              />
              <Fact
                label="执行尝试"
                value={notificationAttemptText(
                  current.run?.executionAttempts ?? current.legacy?.executionAttempts ?? null,
                )}
              />
              <Fact label="本轮来源" value={current.run?.origin ?? '历史记录'} />
              <Fact label="本轮错误码" value={current.run?.lastErrorCode ?? '无记录'} />
              <Fact label="终态证据" value={current.run?.terminalProof ?? '未记录'} />
              <Fact
                label="终态观测时间"
                value={
                  current.run?.terminalObservedAt
                    ? notificationTimestamp(current.run.terminalObservedAt)
                    : '未记录'
                }
              />
              <Fact
                label="当前消费回执"
                value={
                  current.run?.currentEventProcessed ? '已记录，仍需核对完整业务结果' : '未记录'
                }
              />
              <Fact label="旧候选观测" value={current.legacy?.observation ?? '不适用'} />
            </dl>
            {current.definition ? (
              <dl className="grid min-w-0 gap-3 pb-4 text-sm">
                <Fact label="冻结定义修订" value={String(current.definition.settingsRevision)} />
                <Fact
                  label="原互动权重"
                  value={
                    '点赞 ' +
                    current.definition.settings.weights.likes +
                    ' / 收藏 ' +
                    current.definition.settings.weights.favorites +
                    ' / 有效导出 ' +
                    current.definition.settings.weights.exports
                  }
                />
                <Fact
                  label="原容量与新作窗口"
                  value={
                    current.definition.settings.entryLimit +
                    ' 条 / ' +
                    current.definition.settings.newcomerWindowDays +
                    ' 天'
                  }
                />
              </dl>
            ) : (
              <p className="pb-4 text-sm text-muted-foreground">
                此旧算法使用其固定定义，没有可配置快照；不以今日默认值解释历史。
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <CollapsibleTrigger
          render={<Button variant="ghost" />}
          className="h-auto min-h-11 whitespace-normal"
        >
          查看人工处理记录
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          {history.isError ? (
            <RetryHistoryError
              error={history.error}
              retry={() => void history.refetch()}
              pending={history.isFetching}
            />
          ) : history.data && !history.isFetching ? (
            <RetryHistory value={history.data} />
          ) : (
            <Skeleton aria-label="正在读取人工处理记录" className="h-24 w-full" />
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
function RankingStatus({ value }: { value: AdminRankingGeneration }) {
  const title =
    value.completion.state === 'verified'
      ? '已核验完成'
      : value.completion.state === 'legacy_only'
        ? '旧完成记录缺少本轮台账'
        : value.completion.state === 'unverifiable'
          ? '当前结果无法完整核验'
          : value.run?.state === 'failed' || value.businessStatus === 'failed'
            ? '本轮榜单生成未完成'
            : '榜单正在等待或生成';
  return (
    <Alert aria-live="polite">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>
          实际 {value.completion.actualBoards} / 应有 {value.completion.expectedBoards} 块榜板
        </p>
        <p>
          {value.completion.state === 'verified'
            ? '完整榜板、当前轮次和消费凭据均已核对'
            : '队列完成、旧回执或失败列表消失均不能证明本轮业务已完成'}
        </p>
      </AlertDescription>
    </Alert>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="[overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
