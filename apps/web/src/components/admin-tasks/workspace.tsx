'use client';
import Link from 'next/link';
import { useRef, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ADMIN_TASK_MAX_PAGE, AdminTaskQuerySchema } from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { Card, CardHeader, CardTitle, CardContent } from '@personamarket/ui/components/card';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { RefreshCwIcon } from 'lucide-react';
import { authQuery } from '@/lib/auth-api';
import { readAdminTaskFailures } from '@/lib/admin-tasks-api';
import { FormNotice } from '../auth/auth-fields';
import { TaskFilters } from './task-filters';
import { TaskRow } from './task-row';
import { TaskObservationDetails, TaskObservationNotice } from './task-observation';
import { TaskOperationSheet } from './task-operation-sheet';

const subscribe = () => () => {};

export function AdminTasksWorkspace() {
  const hydrated = useSyncExternalStore(
      subscribe,
      () => true,
      () => false,
    ),
    auth = useQuery(authQuery),
    account = auth.data?.data.account;
  if (!hydrated || auth.isPending)
    return <Skeleton aria-label="正在确认登录状态" className="h-64 w-full" />;
  if (auth.isError)
    return (
      <div className="flex flex-col items-start gap-3">
        <FormNotice error={auth.error} />
        <Button onClick={() => void auth.refetch()}>重新确认登录状态</Button>
      </div>
    );
  if (!account || auth.data.data.assurance !== 'authenticated')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{account ? '请完成登录验证' : '请先登录'}</EmptyTitle>
          <EmptyDescription>任务运维仅向管理员开放</EmptyDescription>
        </EmptyHeader>
        <Link href={account ? '/mfa' : '/login'} className={buttonVariants()}>
          {account ? '完成登录验证' : '前往登录'}
        </Link>
      </Empty>
    );
  if (account.role !== 'admin')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>你没有任务运维权限</EmptyTitle>
          <EmptyDescription>请使用管理员账号访问此页面</EmptyDescription>
        </EmptyHeader>
        <Link href="/admin" className={buttonVariants({ variant: 'outline' })}>
          返回管理概览
        </Link>
      </Empty>
    );
  return <TaskList key={account.id} accountId={account.id} />;
}

function TaskList({ accountId }: { accountId: string }) {
  const refreshRef = useRef<HTMLButtonElement>(null);
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const parsed = AdminTaskQuerySchema.safeParse({
    page: search.get('page') ?? 1,
    category: search.get('category') ?? 'all',
    stage: search.get('stage') ?? 'all',
  });
  const input = parsed.success ? parsed.data : undefined;
  const query = useQuery({
    queryKey: ['private', 'admin-tasks', accountId, input ?? search.toString()],
    queryFn: ({ signal }) => {
      if (!input) throw Error('筛选条件无效，请核对类别、阶段和页码');
      return readAdminTaskFailures(accountId, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  function change(values: Record<string, string | undefined>) {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(values)) {
      if (value && value !== 'all') next.set(key, value);
      else next.delete(key);
    }
    next.delete('task');
    router.push(pathname + (next.size ? '?' + next : ''), { scroll: false });
  }
  const defaults = input ?? AdminTaskQuerySchema.parse({});
  const current = query.isError ? undefined : query.data;
  const total = current?.meta.total ?? 0,
    pages = Math.max(1, Math.min(ADMIN_TASK_MAX_PAGE, Math.ceil(total / 20)));
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <TaskFilters initial={defaults} apply={(next) => change({ ...next, page: undefined })} />
      {current && <TaskObservationNotice value={current.meta.queueObservation} />}
      {total > ADMIN_TASK_MAX_PAGE * 20 && (
        <Alert>
          <AlertTitle>当前结果较多</AlertTitle>
          <AlertDescription>
            列表最多展示前 {new Intl.NumberFormat('zh-CN').format(ADMIN_TASK_MAX_PAGE * 20)}{' '}
            条记录，可按类别或阶段缩小范围
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>
            <h2>
              {query.isError
                ? '读取未完成'
                : current && current.meta.queueObservation.status !== 'ready'
                  ? '已知记录'
                  : '需要处理'}
              {current ? ' · ' + new Intl.NumberFormat('zh-CN').format(total) : ''}
            </h2>
          </CardTitle>
          <Button
            ref={refreshRef}
            variant="outline"
            disabled={!input}
            aria-disabled={query.isFetching}
            aria-busy={query.isFetching}
            onClick={() => {
              if (!query.isFetching) void query.refetch();
            }}
          >
            <RefreshCwIcon data-icon="inline-start" aria-hidden />
            {query.isFetching ? '正在刷新…' : '刷新列表'}
          </Button>
        </CardHeader>
        <CardContent className="min-w-0">
          {!input ? (
            <div className="flex flex-col items-start gap-3">
              <FormNotice error="筛选条件无效，请恢复默认筛选后重试" />
              <Button
                onClick={() => change({ category: undefined, stage: undefined, page: undefined })}
              >
                恢复默认筛选
              </Button>
            </div>
          ) : query.isPending ? (
            <Skeleton aria-label="正在读取失败任务" className="h-64 w-full" />
          ) : query.isError ? (
            <div className="flex flex-col items-start gap-3">
              <FormNotice error={query.error} />
              <Button onClick={() => void query.refetch()}>重新读取任务</Button>
            </div>
          ) : query.data.data.length ? (
            <ul className="flex min-w-0 flex-col divide-y">
              {query.data.data.map((task) => (
                <TaskRow
                  key={task.source + ':' + task.id}
                  task={task}
                  accountId={accountId}
                  onUpdated={() => void query.refetch()}
                  returnFocus={refreshRef}
                />
              ))}
            </ul>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {total
                    ? '这一页没有任务'
                    : query.data.meta.queueObservation.status !== 'ready'
                      ? '暂未查询到可核验的失败记录'
                      : '当前没有符合条件的失败任务'}
                </EmptyTitle>
                <EmptyDescription>
                  {total
                    ? '任务状态可能已更新，请返回前面的页码'
                    : query.data.meta.queueObservation.status !== 'ready'
                      ? '队列观测尚未完整，可以刷新后重试，或调整筛选查看已知记录'
                      : '新的失败记录会显示在这里，也可以调整筛选后重新查看'}
                </EmptyDescription>
              </EmptyHeader>
              {(defaults.category !== 'all' || defaults.stage !== 'all' || defaults.page > 1) && (
                <Button
                  variant="outline"
                  onClick={() => change({ category: undefined, stage: undefined, page: undefined })}
                >
                  清空筛选
                </Button>
              )}
            </Empty>
          )}
        </CardContent>
      </Card>
      {current && (pages > 1 || defaults.page > 1) && (
        <nav
          aria-label="失败任务分页"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <span className="text-sm text-muted-foreground">
            第 {defaults.page} 页，共 {pages} 页
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={defaults.page <= 1 || query.isFetching}
              onClick={() => change({ page: String(defaults.page - 1) })}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              disabled={defaults.page >= pages || query.isFetching}
              onClick={() => change({ page: String(defaults.page + 1) })}
            >
              下一页
            </Button>
          </div>
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {query.isFetching
            ? '正在读取最新状态…'
            : query.isError
              ? '本次读取未完成，请重新读取任务'
              : current
                ? current.meta.queueObservation.status === 'ready'
                  ? '已读取最新状态'
                  : '已读取当前可核验记录'
                : ''}
        </p>
        {current && <TaskObservationDetails value={current.meta.queueObservation} />}
      </div>
      <TaskOperationSheet accountId={accountId} returnFocus={refreshRef} />
    </div>
  );
}
