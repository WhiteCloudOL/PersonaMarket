'use client';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OperationalTaskDetail, OperationalTaskPath } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { operationalTasksApi } from '@/lib/operational-tasks-api';
import { FormNotice } from '../auth/auth-fields';
import { notificationAttemptText, notificationTimestamp } from '../notifications/delivery-state';
import { useTaskCommand } from './use-task-command';
import { TaskCommandForm } from './task-command-form';

const statuses = {
  pending: '等待核对清理结果',
  deleted: '文件已清理',
  missing: '目标文件已不存在',
  protected: '文件仍受业务引用保护',
  failed: '本轮清理未完成',
  unrecorded: '旧任务缺少可核验结果',
  sent: '邮件服务已接收',
  sending: '邮件发送处理中',
  uncertain: '邮件发送结果未知',
};
const purposes = {
  email_verify: '验证邮箱',
  password_reset: '重置密码',
  email_change: '变更邮箱',
  security_notice: '账号安全通知',
  review_notice: '审核通知',
};
const sources = {
  account: '账号',
  persona: '人设作品',
  profile_submission: '公开资料送审',
  auth_audit: '账号安全事件',
};
const contextStates = {
  valid: '关联当前有效',
  account_unavailable: '关联账号不可用',
  recipient_changed: '接收地址或资格已变化',
  token_missing: '关联令牌未记录或不存在',
  token_expired: '关联链接已过期',
  token_consumed: '关联链接已使用或已被替代',
  token_mismatch: '令牌与原业务无法匹配',
};
export function OperationalTaskPanel({
  accountId,
  target,
  active,
  onPendingChange,
}: {
  accountId: string;
  target: OperationalTaskPath;
  active: boolean;
  onPendingChange: (value: boolean) => void;
}) {
  const latest = useRef<HTMLButtonElement>(null),
    [settled, setSettled] = useState(0);
  const query = useQuery({
    queryKey: ['private', 'operational-task', accountId, target.kind, target.id],
    queryFn: ({ signal }) => operationalTasksApi.detail(accountId, target, signal),
    enabled: active,
    retry: false,
    staleTime: 0,
  });
  const current = query.isError || query.isFetching ? undefined : query.data?.data,
    mail = target.kind === 'mail';
  const flow = useTaskCommand(
    accountId,
    target,
    () => void query.refetch(),
    () => setSettled((value) => value + 1),
    onPendingChange,
  );
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
        <Skeleton aria-label="正在核对业务任务结果" className="h-40 w-full" />
      ) : query.isError ? (
        <FormNotice error={query.error} />
      ) : (
        current && (
          <>
            <Alert aria-live="polite">
              <AlertTitle>
                {mail && current.status === 'failed'
                  ? '本轮邮件发送未完成'
                  : statuses[current.status]}
              </AlertTitle>
              <AlertDescription>
                {mail
                  ? '这里只记录人工核对，不重发、取消或修改邮件投递结果。人工说明不等于送达确认。'
                  : current.status === 'unrecorded'
                    ? '历史消费凭据不证明文件已删除；只能通过受控本地重查记录真实结果。'
                    : '仅按持久清理结果显示状态；业务引用仍受保护，队列完成不代表文件已删除。'}
              </AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground">
              本次观测：
              {query.data?.meta.observedAt
                ? notificationTimestamp(query.data.meta.observedAt)
                : '未记录'}
            </p>
            {mail && !current.context && (
              <p className="text-sm leading-6 text-muted-foreground">旧邮件缺少业务关联</p>
            )}
            {current.context && (
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{purposes[current.context.purpose]}</Badge>
                <span className="text-sm text-muted-foreground">
                  {contextStates[current.context.state]}
                </span>
              </div>
            )}
            {!mail && current.blockedReason && (
              <p role="status" className="text-sm text-muted-foreground">
                {current.blockedReason}
                {current.nextAllowedAt
                  ? '；可再次核对时间：' + notificationTimestamp(current.nextAllowedAt)
                  : ''}
                {flow.draft?.command ? '。原请求核对仍可使用。' : '。'}
              </p>
            )}
            {mail && (
              <p className="text-sm leading-6 text-muted-foreground">
                结果未知时不盲目重发。失效链接请由账号原业务重新申请；此处说明不会新建邮件。
              </p>
            )}
          </>
        )
      )}
      <TaskCommandForm
        flow={flow}
        target={target}
        version={current?.version}
        eligible={Boolean(current && (mail || current.canRetry))}
        settled={settled}
        latest={latest}
      />
      {current && (
        <>
          <Collapsible>
            <CollapsibleTrigger
              render={<Button variant="ghost" />}
              className="h-auto min-h-11 whitespace-normal"
            >
              查看{mail ? '邮件关联与' : ''}技术详情
            </CollapsibleTrigger>
            <CollapsibleContent>
              <dl className="grid min-w-0 gap-4 py-4 sm:grid-cols-2">
                <Fact label="稳定请求标识" value={current.id} />
                <Fact label="当前事件" value={current.eventId} />
                <Fact
                  label="结果记录时间"
                  value={current.checkedAt ? notificationTimestamp(current.checkedAt) : '未记录'}
                />
                <Fact label="执行尝试" value={notificationAttemptText(current.executionAttempts)} />
                {!mail && (
                  <>
                    <Fact label="目标指纹" value={current.targetFingerprint ?? '未记录'} />
                    <Fact label="人工重查轮次" value={current.manualAttempts + ' / 3'} />
                  </>
                )}
                {current.context && (
                  <>
                    <Fact label="关联用途" value={purposes[current.context.purpose]} />
                    <Fact label="关联来源" value={sources[current.context.sourceType]} />
                    <Fact label="来源标识" value={current.context.sourceId ?? '未记录'} />
                    <Fact label="账号标识" value={current.context.userId ?? '未记录'} />
                    <Fact
                      label="令牌关联"
                      value={current.context.tokenLinked ? '有类型化关联，不展示令牌' : '未记录'}
                    />
                    <Fact
                      label="关联有效期"
                      value={
                        current.context.expiresAt
                          ? notificationTimestamp(current.context.expiresAt)
                          : '不适用或未记录'
                      }
                    />
                  </>
                )}
              </dl>
            </CollapsibleContent>
          </Collapsible>
          <OperationHistory value={current} />
        </>
      )}
    </div>
  );
}
function OperationHistory({ value }: { value: OperationalTaskDetail }) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={<Button variant="ghost" />}
        className="h-auto min-h-11 whitespace-normal"
      >
        查看人工处理记录
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <p className="pb-3 text-sm text-muted-foreground">
          最多展示最近20条说明或处理请求；受理时间与业务结果记录时间分别核对。
        </p>
        {value.history.length ? (
          <ol aria-label="人工处理记录" className="flex min-w-0 flex-col divide-y">
            {value.history.map((record) => (
              <li key={record.id} className="flex min-w-0 flex-col gap-2 py-4">
                <p className="font-medium">
                  {record.action === 'acknowledge' ? '人工核对说明' : '受控清理重查'}
                </p>
                <time dateTime={record.recordedAt} className="text-sm text-muted-foreground">
                  {notificationTimestamp(record.recordedAt)}
                </time>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{record.reason}</p>
                <Collapsible>
                  <CollapsibleTrigger
                    render={<Button variant="ghost" />}
                    className="h-auto min-h-11 whitespace-normal"
                  >
                    查看记录标识
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <dl className="grid min-w-0 gap-3 py-3 text-sm">
                      <Fact label="处理记录" value={record.id} />
                      <Fact label="操作者" value={record.actorId} />
                      <Fact label="新事件" value={record.eventId ?? '仅说明，未创建新事件'} />
                    </dl>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>尚无人工处理记录</EmptyTitle>
              <EmptyDescription>自动处理与原业务操作不计入这里</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CollapsibleContent>
    </Collapsible>
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
