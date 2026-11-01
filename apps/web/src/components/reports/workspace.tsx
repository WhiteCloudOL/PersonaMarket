'use client';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AdminReportsQuerySchema,
  OwnReportsQuerySchema,
  IdSchema,
  type AdminReportsQuery,
} from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { authQuery } from '@/lib/auth-api';
import { reportsApi, reportsKey } from '@/lib/reports-api';
import { FormNotice } from '../auth/auth-fields';
import { announcementDate } from '../announcements/announcement-content';
import { ReportFilters } from './filters';
import { ReportDetail } from './detail';
import { ReportPagination } from './pagination';
import { reportReasons, reportStatuses, reportTypes } from './labels';

const subscribe = () => () => {};
function AuthorizedReports({ accountId, mode }: { accountId: string; mode: 'own' | 'admin' }) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const raw = {
    page: search.get('page') ?? 1,
    status: search.get('status') ?? (mode === 'admin' ? 'pending' : 'all'),
    ...(mode === 'admin'
      ? { type: search.get('type') ?? 'all', ...(search.has('id') ? { id: search.get('id') } : {}) }
      : {}),
  };
  const parsed =
    mode === 'admin'
      ? AdminReportsQuerySchema.safeParse(raw)
      : OwnReportsQuerySchema.safeParse(raw);
  const input = parsed.success ? parsed.data : undefined;
  const filters = input ? AdminReportsQuerySchema.parse({ type: 'all', ...input }) : undefined;
  const selected = IdSchema.safeParse(search.get('report'));
  function navigate(patch: Record<string, string | undefined>, replace = false) {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    router[replace ? 'replace' : 'push'](pathname + (next.size ? '?' + next : ''), {
      scroll: false,
    });
  }
  const query = useQuery<
    | Awaited<ReturnType<typeof reportsApi.adminList>>
    | Awaited<ReturnType<typeof reportsApi.ownList>>
  >({
    queryKey: [...reportsKey(accountId, mode === 'admin'), 'list', input ?? raw],
    queryFn: ({ signal }) => {
      if (!input || !filters) throw new Error('举报筛选条件无效');
      return mode === 'admin'
        ? reportsApi.adminList(accountId, filters, signal)
        : reportsApi.ownList(accountId, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  function apply(next: AdminReportsQuery) {
    navigate({
      status: next.status,
      type: mode === 'admin' ? next.type : undefined,
      id: mode === 'admin' ? next.id : undefined,
      page: undefined,
      report: undefined,
      recordsPage: undefined,
    });
  }
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>查找举报</CardTitle>
          <CardDescription>
            {mode === 'admin'
              ? '默认显示待受理内容，可按状态、内容和举报编号核对'
              : '仅显示自己提交的举报，补充说明不会展示给被举报者'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filters ? (
            <ReportFilters
              key={JSON.stringify(filters)}
              mode={mode}
              initial={filters}
              apply={apply}
            />
          ) : (
            <>
              <FormNotice error="举报筛选条件无效，请清空筛选后重试" />
              <Button onClick={() => router.replace(pathname)}>清空筛选</Button>
            </>
          )}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {query.data ? `共 ${query.data.meta.total} 条举报` : '正在核对举报记录…'}
        </p>
        <Button
          variant="outline"
          disabled={!input || query.isFetching}
          onClick={() => void query.refetch()}
        >
          刷新举报列表
        </Button>
      </div>
      {input && query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <>
          <FormNotice error={query.error} />
          <Button onClick={() => void query.refetch()}>重试读取举报列表</Button>
        </>
      ) : (
        query.data && (
          <>
            {query.data.data.length ? (
              <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                {query.data.data.map((row) => (
                  <Card key={row.id}>
                    <CardHeader>
                      <div className="flex flex-wrap gap-2">
                        <Badge
                          variant={
                            row.status === 'pending' || row.status === 'processing'
                              ? 'default'
                              : 'secondary'
                          }
                        >
                          {reportStatuses[row.status]}
                        </Badge>
                        <Badge variant="outline">{reportTypes[row.type]}</Badge>
                      </div>
                      <CardTitle className="[overflow-wrap:anywhere]">{row.personaTitle}</CardTitle>
                      <CardDescription>
                        {row.version ? 'v' + row.version + ' · ' : ''}
                        {reportReasons[row.reason]} · {announcementDate(row.createdAt)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex min-w-0 flex-col gap-3">
                      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                        举报编号：{row.id}
                      </p>
                      {'reporter' in row && (
                        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                          举报人：{row.reporter.username}
                        </p>
                      )}
                      <Button
                        variant="outline"
                        className="self-start"
                        aria-label={'查看举报：' + row.personaTitle}
                        onClick={() => navigate({ report: row.id, recordsPage: undefined })}
                      >
                        {mode === 'admin' ? '查看并处理' : '查看处理进度'}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>没有符合条件的举报</EmptyTitle>
                  <EmptyDescription>
                    {mode === 'admin'
                      ? '当前条件下没有需要处理的记录，可调整筛选查看历史记录'
                      : '发现公开内容有问题时，可从人设详情或公开评论提交举报'}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {input && (
              <ReportPagination
                page={input.page}
                total={query.data.meta.total}
                busy={query.isFetching}
                label="举报列表分页"
                change={(page) =>
                  navigate({ page: String(page), report: undefined, recordsPage: undefined })
                }
              />
            )}
          </>
        )
      )}
      {search.has('report') && !selected.success && (
        <>
          <FormNotice error="举报编号无效，请从列表重新选择" />
          <Button onClick={() => navigate({ report: undefined, recordsPage: undefined }, true)}>
            返回举报列表
          </Button>
        </>
      )}
      {selected.success && (
        <ReportDetail
          key={selected.data}
          accountId={accountId}
          id={selected.data}
          mode={mode}
          close={() => navigate({ report: undefined, recordsPage: undefined }, true)}
        />
      )}
    </div>
  );
}
export function ReportsWorkspace({ mode }: { mode: 'own' | 'admin' }) {
  const hydrated = useSyncExternalStore(
      subscribe,
      () => true,
      () => false,
    ),
    auth = useQuery(authQuery);
  if (!hydrated || auth.isPending) return <Skeleton className="h-64 w-full" />;
  if (auth.isError)
    return (
      <>
        <FormNotice error={auth.error} />
        <Button onClick={() => void auth.refetch()}>重新确认登录状态</Button>
      </>
    );
  const account = auth.data.data.account;
  if (!account || auth.data.data.assurance !== 'authenticated')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{account ? '请完成登录验证' : '请先登录'}</EmptyTitle>
          <EmptyDescription>
            {mode === 'admin' ? '使用管理员账号处理举报' : '登录后查看自己提交的举报记录'}
          </EmptyDescription>
        </EmptyHeader>
        <Link className={buttonVariants()} href={account ? '/mfa' : '/login'}>
          {account ? '完成登录验证' : '前往登录'}
        </Link>
      </Empty>
    );
  if (mode === 'admin' && account.role !== 'admin')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>你没有举报管理权限</EmptyTitle>
          <EmptyDescription>请使用管理员账号访问此页面</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return <AuthorizedReports key={account.id} accountId={account.id} mode={mode} />;
}
