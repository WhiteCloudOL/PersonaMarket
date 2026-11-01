'use client';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { TaxonomyManagementPaginationSchema, type TaxonomyKind } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { FormNotice } from '../auth/auth-fields';
import { taxonomyManagementApi, taxonomyManagementKey } from '@/lib/taxonomy-management-api';

const actions = {
  created: '创建条目',
  updated: '调整目录',
  archived: '归档条目',
  restored: '恢复条目',
};
export function TaxonomyRecords({
  accountId,
  kind,
  id,
  active,
}: {
  accountId: string;
  kind: TaxonomyKind;
  id: string;
  active: boolean;
}) {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const parsed = TaxonomyManagementPaginationSchema.safeParse({
    page: search.get('recordsPage') ?? 1,
    pageSize: 20,
  });
  const input = parsed.success ? parsed.data : undefined;
  const query = useQuery({
    queryKey: [
      ...taxonomyManagementKey(accountId, kind),
      'records',
      id,
      input ?? search.get('recordsPage'),
    ],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('记录页码无效');
      return taxonomyManagementApi.records(accountId, kind, id, input, signal);
    },
    enabled: active && Boolean(input),
    retry: false,
  });
  function change(page: number) {
    const next = new URLSearchParams(search);
    if (page === 1) next.delete('recordsPage');
    else next.set('recordsPage', String(page));
    router.replace(pathname + '?' + next.toString(), { scroll: false });
  }
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="目录记录">
      <h3 className="font-semibold">目录记录</h3>
      {!input ? (
        <>
          <FormNotice error={new Error('记录页码无效，请返回第一页')} />
          <Button onClick={() => change(1)} variant="outline">
            返回记录第一页
          </Button>
        </>
      ) : query.isPending ? (
        <Skeleton className="h-36 w-full" />
      ) : query.isError ? (
        <>
          <FormNotice error={query.error} />
          <Button onClick={() => void query.refetch()} variant="outline">
            重试读取记录
          </Button>
        </>
      ) : (
        query.data && (
          <>
            {!query.data.data.length ? (
              <p className="text-sm text-muted-foreground">这一页暂无目录记录</p>
            ) : (
              <ol className="flex min-w-0 flex-col gap-4">
                {query.data.data.map((record) => (
                  <li
                    key={record.id}
                    className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-3"
                  >
                    <h4 className="text-sm font-medium">{actions[record.action]}</h4>
                    <p className="break-words text-sm text-muted-foreground">
                      {record.actor} ·{' '}
                      <time dateTime={record.createdAt}>
                        {new Date(record.createdAt).toLocaleString('zh-CN')}
                      </time>
                    </p>
                    <p
                      tabIndex={0}
                      role="region"
                      aria-label="本次目录处理理由"
                      className="max-h-[40dvh] overflow-y-auto rounded-md text-sm whitespace-pre-wrap [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {record.reason}
                    </p>
                    <dl className="grid min-w-0 gap-1 text-sm">
                      <dt className="text-muted-foreground">处理前</dt>
                      <dd className="[overflow-wrap:anywhere]">
                        {record.before
                          ? `${record.before.name} · ${record.before.archivedAt ? '已归档' : record.before.active ? '已启用' : '已停用'} · 排序 ${record.before.sortOrder}`
                          : '尚未创建'}
                      </dd>
                      <dt className="text-muted-foreground">处理后</dt>
                      <dd className="[overflow-wrap:anywhere]">
                        {record.after.name} ·{' '}
                        {record.after.archivedAt
                          ? '已归档'
                          : record.after.active
                            ? '已启用'
                            : '已停用'}{' '}
                        · 排序 {record.after.sortOrder}
                      </dd>
                    </dl>
                  </li>
                ))}
              </ol>
            )}
            <nav
              aria-label="目录记录分页"
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <Button
                variant="outline"
                disabled={input.page <= 1}
                onClick={() => change(input.page - 1)}
              >
                上一页记录
              </Button>
              <span className="text-sm text-muted-foreground">
                第 {input.page} 页 / {query.data.meta.total} 条
              </span>
              <Button
                variant="outline"
                disabled={input.page >= 50 || input.page * input.pageSize >= query.data.meta.total}
                onClick={() => change(input.page + 1)}
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
