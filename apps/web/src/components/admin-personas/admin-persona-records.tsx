'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AdminPersonaRecordsQuerySchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { adminPersonasApi, adminPersonasKey } from '@/lib/admin-personas-api';
import { FormNotice } from '../auth/auth-fields';

const labels: Record<string, string> = {
  persona_blocked: '下架作品',
  persona_unblocked: '解除下架',
  persona_curated: '调整推荐标记',
  approved: '通过审核',
  rejected: '退回修改',
  submitted: '提交版本',
  author_hidden: '作者隐藏',
  author_listed: '作者公开',
  submission_withdrawn: '撤回送审',
  restored_to_draft: '复制历史快照到草稿',
  public_version_selected: '切换展示版本',
  release_withdraw: '撤回版本',
  release_block: '下架版本',
  release_restore: '恢复版本',
};
export function AdminPersonaRecords({ accountId, id }: { accountId: string; id: string }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const parsed = AdminPersonaRecordsQuerySchema.safeParse({
    page: search.get('recordsPage') ?? 1,
    pageSize: 20,
  });
  const input = parsed.success ? parsed.data : undefined;
  const query = useQuery({
    queryKey: [...adminPersonasKey(accountId), 'records', id, input ?? search.get('recordsPage')],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('记录页码无效');
      return adminPersonasApi.records(accountId, id, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  function change(page: number) {
    const next = new URLSearchParams(search);
    if (page === 1) next.delete('recordsPage');
    else next.set('recordsPage', String(page));
    router.replace(pathname + '?' + next.toString(), { scroll: false });
  }
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="管理记录">
      <h3 className="font-semibold">管理记录</h3>
      {!input ? (
        <>
          <FormNotice error={new Error('记录页码无效，请返回第一页')} />
          <Button variant="outline" onClick={() => change(1)}>
            返回记录第一页
          </Button>
        </>
      ) : query.isPending ? (
        <Skeleton className="h-32 w-full" aria-label="正在读取管理记录" />
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
            {query.data.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">这一页暂无管理记录</p>
            ) : (
              <ol className="flex min-w-0 flex-col gap-4">
                {query.data.data.map((record) => (
                  <li
                    key={record.id}
                    className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-3"
                  >
                    <h4 className="text-sm font-medium">
                      {labels[record.action] ?? record.action}
                      {record.selfReview ? ' · 本人操作' : ''}
                    </h4>
                    <p className="break-words text-sm text-muted-foreground">
                      {record.actor} ·{' '}
                      <time dateTime={record.createdAt}>
                        {new Date(record.createdAt).toLocaleString('zh-CN')}
                      </time>
                    </p>
                    <p
                      tabIndex={0}
                      role="region"
                      aria-label="本项处理理由"
                      className="max-h-[40dvh] overflow-y-auto rounded-md text-sm whitespace-pre-wrap [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {record.reason || '未填写处理理由'}
                    </p>
                    {record.submissionId && (
                      <Link
                        className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
                        href={'/admin/moderation?submission=' + record.submissionId}
                      >
                        查看对应快照
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <nav
              aria-label="管理记录分页"
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
                disabled={
                  input.page >= 2500 || input.page * input.pageSize >= query.data.meta.total
                }
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
