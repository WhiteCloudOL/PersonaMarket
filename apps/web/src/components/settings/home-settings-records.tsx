'use client';
import { useId, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  HomeSettingsRecordsQuerySchema,
  type HomeSettingsRecordsResponseSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { homeSettingsApi, homeSettingsKey } from '@/lib/home-settings-api';
import { FormNotice } from '../auth/auth-fields';
import { EditorSection } from '../personas/editor-section';
import { HomeSettingsSummary } from './home-settings-summary';
import { announcementDate } from '../announcements/announcement-content';

function Record({
  record,
}: {
  record: z.infer<typeof HomeSettingsRecordsResponseSchema>['data'][number];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3">
      <p className="text-sm font-medium [overflow-wrap:anywhere]">
        {record.actor} · 修订 {record.fromRevision} → {record.toRevision}
      </p>
      <time dateTime={record.createdAt} className="text-sm text-muted-foreground">
        {announcementDate(record.createdAt)}
      </time>
      <div
        role="region"
        aria-label="首页修改理由"
        tabIndex={0}
        className="max-h-40 overflow-y-auto overscroll-contain rounded-lg whitespace-pre-wrap text-sm [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
      >
        {record.reason}
      </div>
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="self-start"
      >
        {open ? '收起修改差异' : '查看修改差异'}
      </Button>
      {open && (
        <div id={id} className="grid min-w-0 gap-5 lg:grid-cols-2">
          <section className="flex min-w-0 flex-col gap-3">
            <h3 className="font-semibold">修改前</h3>
            <HomeSettingsSummary value={record.before} />
          </section>
          <section className="flex min-w-0 flex-col gap-3">
            <h3 className="font-semibold">修改后</h3>
            <HomeSettingsSummary value={record.after} />
          </section>
        </div>
      )}
    </li>
  );
}
export function HomeSettingsRecords({ accountId }: { accountId: string }) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const parsed = HomeSettingsRecordsQuerySchema.safeParse({ page: search.get('historyPage') ?? 1 });
  const input = parsed.success ? parsed.data : undefined;
  const query = useQuery({
    queryKey: [...homeSettingsKey(accountId), 'records', input ?? search.get('historyPage')],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('首页记录页码无效');
      return homeSettingsApi.records(accountId, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  function change(page: number) {
    const next = new URLSearchParams(search);
    if (page === 1) next.delete('historyPage');
    else next.set('historyPage', String(page));
    router.replace(pathname + (next.size ? '?' + next.toString() : ''), { scroll: false });
  }
  return (
    <EditorSection title="首页修改记录" description="核对修改人、处理理由及每次设置差异，记录只读">
      {!input ? (
        <>
          <FormNotice error="记录页码无效，请返回第一页" />
          <Button type="button" variant="outline" onClick={() => change(1)}>
            返回记录第一页
          </Button>
        </>
      ) : query.isPending ? (
        <div role="status">
          <span className="sr-only">正在读取首页修改记录…</span>
          <Skeleton className="h-32 w-full" aria-hidden="true" />
        </div>
      ) : query.isError ? (
        <>
          <FormNotice error={query.error} />
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            重新读取首页记录
          </Button>
        </>
      ) : (
        <>
          {!query.data.data.length ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                {query.data.meta.total ? '这一页没有修改记录' : '还没有首页修改记录'}
              </p>
              {query.data.meta.total > 0 && (
                <Button type="button" variant="outline" onClick={() => change(1)}>
                  返回记录第一页
                </Button>
              )}
            </div>
          ) : (
            <ol className="flex min-w-0 flex-col gap-3">
              {query.data.data.map((record) => (
                <Record key={record.id} record={record} />
              ))}
            </ol>
          )}
          <nav
            aria-label="首页记录分页"
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <Button
              type="button"
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
              type="button"
              variant="outline"
              disabled={input.page >= 100 || input.page * 20 >= query.data.meta.total}
              onClick={() => change(input.page + 1)}
            >
              下一页记录
            </Button>
          </nav>
        </>
      )}
    </EditorSection>
  );
}
