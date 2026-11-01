'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AnnouncementRecordsQuerySchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { FormNotice } from '../auth/auth-fields';
import { announcementsApi, announcementsKey } from '@/lib/announcements-api';
import { announcementDate } from './announcement-content';
const actions = {
  created: '创建编辑稿',
  edited: '保存编辑稿',
  published: '发布公告',
  withdrawn: '撤回公告',
  archived: '归档公告',
  restored: '恢复公告',
};
const statuses = { draft: '未发布', published: '已公开', withdrawn: '已撤回', archived: '已归档' };
export function AnnouncementRecords({
  accountId,
  id,
  open,
}: {
  accountId: string;
  id: string;
  open: boolean;
}) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const parsed = AnnouncementRecordsQuerySchema.safeParse({ page: search.get('recordsPage') ?? 1 });
  const input = parsed.success ? parsed.data : undefined;
  const query = useQuery({
    queryKey: [...announcementsKey(accountId), 'records', id, input ?? search.get('recordsPage')],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('记录页码无效');
      return announcementsApi.records(accountId, id, input, signal);
    },
    enabled: open && Boolean(input),
    retry: false,
  });
  function change(page: number) {
    const next = new URLSearchParams(search);
    if (page === 1) next.delete('recordsPage');
    else next.set('recordsPage', String(page));
    router.replace(pathname + '?' + next.toString(), { scroll: false });
  }
  return (
    <section aria-label="公告记录" className="flex min-w-0 flex-col gap-4">
      <h3 className="font-semibold">公告记录</h3>
      {!input ? (
        <>
          <FormNotice error={new Error('记录页码无效，请返回第一页')} />
          <Button variant="outline" onClick={() => change(1)}>
            返回记录第一页
          </Button>
        </>
      ) : query.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : query.isError ? (
        <>
          <FormNotice error={query.error} />
          <Button variant="outline" onClick={() => void query.refetch()}>
            重试读取记录
          </Button>
        </>
      ) : (
        query.data && (
          <>
            {!query.data.data.length ? (
              <p className="text-sm text-muted-foreground">这一页暂无公告记录</p>
            ) : (
              <ol className="flex min-w-0 flex-col gap-4">
                {query.data.data.map((record) => (
                  <li
                    key={record.id}
                    className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-3"
                  >
                    <h4 className="text-sm font-medium">{actions[record.action]}</h4>
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {record.actor} ·{' '}
                      <time dateTime={record.createdAt}>{announcementDate(record.createdAt)}</time>
                    </p>
                    <div
                      tabIndex={0}
                      role="region"
                      aria-label="公告处理理由"
                      className="max-h-[40dvh] overflow-y-auto overscroll-contain rounded-lg whitespace-pre-wrap text-sm [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {record.reason}
                    </div>
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {record.before
                        ? `${statuses[record.before.status]} · 修订 ${record.before.revision} → `
                        : ''}
                      {statuses[record.after.status]} · 修订 {record.after.revision} · 正文{' '}
                      {record.after.bodyCharacters} 字
                    </p>
                    <p className="text-sm [overflow-wrap:anywhere]">{record.after.title}</p>
                  </li>
                ))}
              </ol>
            )}
            <nav
              aria-label="公告记录分页"
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <Button
                variant="outline"
                disabled={!input || input.page <= 1}
                onClick={() => change((input?.page ?? 1) - 1)}
              >
                上一页记录
              </Button>
              <span className="text-sm">
                第 {input?.page} 页 · 共 {query.data.meta.total} 条
              </span>
              <Button
                variant="outline"
                disabled={
                  !input ||
                  input.page >= 100 ||
                  input.page * input.pageSize >= query.data.meta.total
                }
                onClick={() => change((input?.page ?? 1) + 1)}
              >
                下一页记录
              </Button>
            </nav>
          </>
        )
      )}
    </section>
  );
}
