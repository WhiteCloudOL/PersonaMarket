'use client';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ReportRecordsQuerySchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { reportsApi, reportsKey } from '@/lib/reports-api';
import { FormNotice } from '../auth/auth-fields';
import { announcementDate } from '../announcements/announcement-content';
import { ReportPagination } from './pagination';
import { reportRecordActions, reportStatuses } from './labels';
import { reportContentActions } from '@/lib/report-action-form';

export function ReportRecords({
  accountId,
  id,
  mode,
}: {
  accountId: string;
  id: string;
  mode: 'own' | 'admin';
}) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const parsed = ReportRecordsQuerySchema.safeParse({ page: search.get('recordsPage') ?? 1 });
  const page = parsed.success ? parsed.data.page : undefined;
  const query = useQuery<
    | Awaited<ReturnType<typeof reportsApi.adminRecords>>
    | Awaited<ReturnType<typeof reportsApi.ownRecords>>
  >({
    queryKey: [...reportsKey(accountId, mode === 'admin'), 'records', id, page],
    queryFn: ({ signal }) => {
      if (!page) throw new Error('处理记录页码无效');
      return mode === 'admin'
        ? reportsApi.adminRecords(accountId, id, page, signal)
        : reportsApi.ownRecords(accountId, id, page, signal);
    },
    enabled: Boolean(page),
    retry: false,
  });
  function change(next: number) {
    const params = new URLSearchParams(search);
    params.set('recordsPage', String(next));
    router.replace(pathname + '?' + params, { scroll: false });
  }
  return (
    <section aria-label="举报处理记录" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">处理记录</h2>
        <Button
          variant="outline"
          disabled={query.isFetching || !page}
          onClick={() => void query.refetch()}
        >
          刷新处理记录
        </Button>
      </div>
      {!page ? (
        <>
          <FormNotice error="处理记录页码无效，请返回第一页" />
          <Button onClick={() => change(1)}>返回记录第一页</Button>
        </>
      ) : query.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : query.isError ? (
        <>
          <FormNotice error={query.error} />
          <Button onClick={() => void query.refetch()}>重试读取记录</Button>
        </>
      ) : (
        <>
          <ol className="flex min-w-0 flex-col gap-3">
            {query.data.data.map((row) => (
              <li
                key={row.id}
                className="flex min-w-0 flex-col gap-2 rounded-xl border p-4 [overflow-wrap:anywhere]"
              >
                <h3 className="font-medium">{reportRecordActions[row.action]}</h3>
                <p className="text-sm text-muted-foreground">
                  {typeof row.actor === 'string'
                    ? row.actor === 'you'
                      ? '我'
                      : '管理员'
                    : row.actor.username}{' '}
                  · <time dateTime={row.createdAt}>{announcementDate(row.createdAt)}</time>
                </p>
                <p className="text-sm text-muted-foreground">
                  {reportStatuses[row.afterStatus]} · 修订 {row.toRevision}
                </p>
                {row.message && (
                  <p className="whitespace-pre-wrap text-base leading-7">{row.message}</p>
                )}
                {row.resolution && (
                  <p className="text-sm font-medium">
                    {row.resolution.content ? reportContentActions[row.resolution.content] : ''}
                    {row.resolution.content && row.resolution.account ? ' · ' : ''}
                    {row.resolution.account ? '已限制被举报账号' : ''}
                  </p>
                )}
                {'resolutionDetail' in row && row.resolutionDetail && (
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-sm font-medium">被处置者可见说明</p>
                    <p className="whitespace-pre-wrap text-base leading-7">
                      {row.resolutionDetail.command.reason}
                    </p>
                  </div>
                )}
                {'privateNote' in row && row.privateNote && (
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-sm font-medium">仅管理员可见</p>
                    <p className="whitespace-pre-wrap text-base leading-7">{row.privateNote}</p>
                  </div>
                )}
                {'selfReview' in row && row.selfReview && (
                  <p className="text-sm text-muted-foreground">
                    已明确确认本人关联操作并验证近期身份
                  </p>
                )}
              </li>
            ))}
          </ol>
          {query.data.data.length === 0 && (
            <p className="text-sm text-muted-foreground">还没有可见处理记录</p>
          )}
          <ReportPagination
            page={page}
            total={query.data.meta.total}
            change={change}
            busy={query.isFetching}
            label="处理记录分页"
          />
        </>
      )}
    </section>
  );
}
