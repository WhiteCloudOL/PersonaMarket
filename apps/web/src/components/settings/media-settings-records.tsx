'use client';
import { useId, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  MediaSettingsRecordsQuerySchema,
  type MediaSettingsRecordsResponseSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { mediaSettingsApi, mediaSettingsKey } from '@/lib/media-settings-api';
import { FormNotice } from '../auth/auth-fields';
import { EditorSection } from '../personas/editor-section';
import { MediaSettingsSummary } from './media-settings-summary';
import { announcementDate } from '../announcements/announcement-content';

function Record({
  record,
}: {
  record: z.infer<typeof MediaSettingsRecordsResponseSchema>['data'][number];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3">
      <p className="text-sm font-medium [overflow-wrap:anywhere]">{record.actor}</p>
      <time dateTime={record.createdAt} className="text-sm text-muted-foreground">
        {announcementDate(record.createdAt)}
      </time>
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
            <MediaSettingsSummary value={record.before} />
          </section>
          <section className="flex min-w-0 flex-col gap-3">
            <h3 className="font-semibold">修改后</h3>
            <MediaSettingsSummary value={record.after} />
          </section>
        </div>
      )}
    </li>
  );
}
export function MediaSettingsRecords({ accountId }: { accountId: string }) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const parsed = MediaSettingsRecordsQuerySchema.safeParse({
    page: search.get('historyPage') ?? 1,
  });
  const input = parsed.success ? parsed.data : undefined;
  const query = useQuery({
    queryKey: [...mediaSettingsKey(accountId), 'records', input ?? search.get('historyPage')],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('文件与图片记录页码无效');
      return mediaSettingsApi.records(accountId, input, signal);
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
    <EditorSection title="文件与图片修改记录" description="核对修改人及每次设置差异，记录只读">
      {!input ? (
        <>
          <FormNotice error="记录页码无效，请返回第一页" />
          <Button type="button" variant="outline" onClick={() => change(1)}>
            返回记录第一页
          </Button>
        </>
      ) : query.isPending ? (
        <div role="status">
          <span className="sr-only">正在读取文件与图片修改记录…</span>
          <Skeleton className="h-32 w-full" aria-hidden="true" />
        </div>
      ) : query.isError ? (
        <>
          <FormNotice error={query.error} />
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            重新读取文件与图片记录
          </Button>
        </>
      ) : (
        <>
          {!query.data.data.length ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                {query.data.meta.total ? '这一页没有修改记录' : '还没有文件与图片修改记录'}
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
            aria-label="文件与图片记录分页"
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
