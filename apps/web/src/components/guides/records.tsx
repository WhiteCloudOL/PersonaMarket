'use client';
import { useId, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GuideRecordsQuerySchema, type GuideSlug } from '@personamarket/contracts';
import type { z } from 'zod';
import type { GuideRecordsResponseSchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { FormNotice } from '../auth/auth-fields';
import { announcementDate } from '../announcements/announcement-content';
import { guidesApi, guidesKey } from '@/lib/guides-api';
import { guideStatuses } from './guide-labels';
type RecordItem = z.infer<typeof GuideRecordsResponseSchema>['data'][number];
const actions = { edited: '保存编辑稿', published: '发布指南', withdrawn: '撤回指南' };
function GuideRecord({ record }: { record: RecordItem }) {
  const [expanded, setExpanded] = useState(false),
    id = useId();
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
      <h4 className="font-medium">{actions[record.action]}</h4>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {record.actor} ·{' '}
        <time dateTime={record.createdAt}>{announcementDate(record.createdAt)}</time>
      </p>
      <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{record.reason}</p>
      <p className="text-sm text-muted-foreground">
        {guideStatuses[record.before.status]} · 修订 {record.before.revision} →{' '}
        {guideStatuses[record.after.status]} · 修订 {record.after.revision}
      </p>
      <Button
        variant="outline"
        className="self-start"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? '收起修订详情' : '查看修订详情'}
      </Button>
      {expanded && (
        <div id={id} className="grid min-w-0 gap-4 lg:grid-cols-2">
          {(['before', 'after'] as const).map((key) => {
            const value = record[key];
            return (
              <section key={key} className="flex min-w-0 flex-col gap-2">
                <h5 className="font-medium">{key === 'before' ? '变更前' : '变更后'}</h5>
                <p className="text-sm [overflow-wrap:anywhere]">{value.title}</p>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {value.summary}
                </p>
                <pre
                  role="region"
                  aria-label={key === 'before' ? '变更前正文' : '变更后正文'}
                  tabIndex={0}
                  className="max-h-[40dvh] min-w-0 overflow-y-auto overscroll-contain rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {value.bodyMarkdown}
                </pre>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  正文校验：{value.contentHash}
                </p>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  公开版本：{value.publishedId ?? '尚无公开版本'}
                </p>
                {value.publishedContentHash && (
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    公开稿校验：{value.publishedContentHash}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </li>
  );
}
export function GuideRecords({ accountId, slug }: { accountId: string; slug: GuideSlug }) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const parsed = GuideRecordsQuerySchema.safeParse({ page: search.get('historyPage') ?? 1 });
  const input = parsed.success ? parsed.data : undefined;
  const query = useQuery({
    queryKey: [...guidesKey(accountId), 'records', slug, input ?? search.get('historyPage')],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('记录页码无效');
      return guidesApi.records(accountId, slug, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  function change(page: number) {
    const next = new URLSearchParams(search);
    if (page === 1) next.delete('historyPage');
    else next.set('historyPage', String(page));
    router.replace(pathname + '?' + next.toString(), { scroll: false });
  }
  return (
    <section aria-label="指南记录" className="flex min-w-0 flex-col gap-4">
      <h3 className="font-semibold">指南记录</h3>
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
            {query.data.data.length ? (
              <ol className="flex min-w-0 flex-col gap-4">
                {query.data.data.map((record) => (
                  <GuideRecord key={record.id} record={record} />
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">这一页暂无指南记录</p>
            )}
            <nav
              aria-label="指南记录分页"
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <Button
                variant="outline"
                disabled={input.page <= 1}
                onClick={() => change(input.page - 1)}
              >
                上一页记录
              </Button>
              <span className="text-sm">
                第 {input.page} 页 · 共 {query.data.meta.total} 条
              </span>
              <Button
                variant="outline"
                disabled={input.page >= 100 || input.page * 20 >= query.data.meta.total}
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
