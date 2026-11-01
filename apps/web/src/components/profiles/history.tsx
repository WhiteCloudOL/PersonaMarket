'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ProfileHistoryQuerySchema } from '@personamarket/contracts';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { profilesApi, profilesKey } from '@/lib/profiles-api';
import { FormNotice } from '../auth/auth-fields';
import { announcementDate } from '../announcements/announcement-content';
import { ProfileContentView, profileStatuses } from './content';
const actions = {
  submit: '提交审核',
  withdraw: '撤回待审资料',
  approve: '审核通过',
  reject: '退回调整',
  hide: '隐藏公开资料',
  restore: '恢复公开资料',
} as const;
export function ProfileHistory({
  accountId,
  kind,
  userId,
}: {
  accountId: string;
  kind: 'submissions' | 'records';
  userId?: string;
}) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const parameter = kind === 'records' ? 'profileRecordsPage' : 'profileHistoryPage';
  const parsed = ProfileHistoryQuerySchema.safeParse({
    page: search.get(parameter) ?? 1,
    pageSize: 20,
  });
  const page = parsed.success ? parsed.data.page : 1;
  function setPage(nextPage: number) {
    const next = new URLSearchParams(search);
    if (nextPage === 1) next.delete(parameter);
    else next.set(parameter, String(nextPage));
    router.push(pathname + (next.size ? '?' + next : ''), { scroll: false });
  }
  const submissions = useQuery({
    queryKey: [...profilesKey(accountId), 'history', page],
    queryFn: ({ signal }) => profilesApi.history(accountId, page, signal),
    enabled: kind === 'submissions' && parsed.success,
    retry: false,
  });
  const records = useQuery({
    queryKey: [...profilesKey(accountId, Boolean(userId)), 'records', userId ?? accountId, page],
    queryFn: ({ signal }) => profilesApi.records(accountId, page, signal, userId),
    enabled: kind === 'records' && parsed.success,
    retry: false,
  });
  const query = kind === 'submissions' ? submissions : records;
  if (!parsed.success)
    return (
      <>
        <FormNotice error="资料历史页码无效，请回到第一页" />
        <Button onClick={() => setPage(1)}>回到资料历史第一页</Button>
      </>
    );
  if (query.isPending) return <Skeleton className="h-48 w-full" />;
  if (query.isError)
    return (
      <div className="flex flex-col gap-3">
        <FormNotice error={query.error} />
        <Button onClick={() => void query.refetch()}>重试读取资料历史</Button>
      </div>
    );
  const meta = query.data?.meta;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {meta?.total === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              <h2>暂无资料记录</h2>
            </EmptyTitle>
            <EmptyDescription>提交或处理资料后，这里会保留真实历史</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {kind === 'submissions'
        ? submissions.data?.data.map((row) => (
            <details key={row.id} className="group min-w-0 rounded-xl border bg-card p-4">
              <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-3 [overflow-wrap:anywhere]">
                <span className="font-medium">{row.snapshot.displayName}</span>
                <Badge variant="outline">{profileStatuses[row.status]}</Badge>
                <time className="text-sm text-muted-foreground" dateTime={row.createdAt}>
                  {announcementDate(row.createdAt)}
                </time>
              </summary>
              <div className="mt-4 flex flex-col gap-4">
                <ProfileContentView
                  content={row.snapshot}
                  avatarSrc={
                    row.snapshot.avatarAssetId
                      ? '/api/v1/me/assets/' + row.snapshot.avatarAssetId
                      : null
                  }
                />
                {row.reason && (
                  <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">
                    处理说明：{row.reason}
                  </p>
                )}
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  快照编号：{row.id}
                </p>
              </div>
            </details>
          ))
        : records.data?.data.map((row) => (
            <article
              key={row.id}
              className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 [overflow-wrap:anywhere]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium">{actions[row.action]}</h3>
                <time className="text-sm text-muted-foreground" dateTime={row.createdAt}>
                  {announcementDate(row.createdAt)}
                </time>
              </div>
              <p className="text-sm text-muted-foreground">
                由 {row.actor.username} 操作{row.selfReview ? ' · 管理员自审' : ''}
              </p>
              {row.reason && (
                <p className="whitespace-pre-wrap text-base leading-7">{row.reason}</p>
              )}
            </article>
          ))}
      {meta && meta.total > 0 && (
        <nav
          aria-label="资料历史分页"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <p className="text-sm text-muted-foreground">
            第 {page} 页 · 共 {meta.total} 条
          </p>
          <Button
            variant="outline"
            disabled={page * meta.pageSize >= meta.total}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </nav>
      )}
    </div>
  );
}
