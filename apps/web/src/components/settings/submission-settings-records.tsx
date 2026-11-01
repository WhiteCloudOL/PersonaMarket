'use client';
import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  SubmissionSettingsRecordsQuerySchema,
  type SubmissionSettingsRecordsResponseSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { creationSettingsApi, creationSettingsKey } from '@/lib/creation-settings-api';
import { FormNotice } from '../auth/auth-fields';
import { announcementDate } from '../announcements/announcement-content';
import { SubmissionSettingsSummary } from './creation-settings-summary';

function Record({
  record,
}: {
  record: z.infer<typeof SubmissionSettingsRecordsResponseSchema>['data'][number];
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
      <p className="text-sm font-medium [overflow-wrap:anywhere]">
        {record.actor} · 投稿修订 {record.fromRevision} → {record.toRevision}
      </p>
      <time dateTime={record.createdAt} className="text-sm text-muted-foreground">
        {announcementDate(record.createdAt)}
      </time>
      <p className="whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]">
        {record.reason}
      </p>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger render={<Button type="button" variant="outline" />}>
          {open ? '收起投稿修改差异' : '查看投稿修改差异'}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          {open && (
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <section className="flex min-w-0 flex-col gap-3">
                <h3 className="font-semibold">修改前</h3>
                <SubmissionSettingsSummary value={record.before} />
              </section>
              <section className="flex min-w-0 flex-col gap-3">
                <h3 className="font-semibold">修改后</h3>
                <SubmissionSettingsSummary value={record.after} />
              </section>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
export function SubmissionSettingsRecords({ accountId }: { accountId: string }) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const parsed = SubmissionSettingsRecordsQuerySchema.safeParse({
    page: search.get('historyPage') ?? 1,
  });
  const input = parsed.success ? parsed.data : undefined;
  const query = useQuery({
    queryKey: [...creationSettingsKey(accountId), 'records', input ?? search.get('historyPage')],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('投稿记录页码无效');
      return creationSettingsApi.records(accountId, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  const change = (page: number) => {
    const next = new URLSearchParams(search.toString());
    if (page === 1) next.delete('historyPage');
    else next.set('historyPage', page.toString());
    router.replace(pathname + (next.size ? '?' + next.toString() : ''), { scroll: false });
  };
  if (!input) return <FormNotice error="投稿记录页码无效，请使用 1 至 100 页" />;
  return (
    <section aria-label="投稿策略修改记录" className="flex min-w-0 flex-col gap-4 pt-4">
      <h2 className="text-lg font-semibold">投稿策略修改记录</h2>
      {query.isPending ? (
        <p role="status">正在读取投稿策略修改记录…</p>
      ) : query.isError ? (
        <div className="flex flex-col items-start gap-3">
          <FormNotice error={query.error} />
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            重新读取投稿记录
          </Button>
        </div>
      ) : (
        <>
          {query.data.data.length ? (
            <ol className="flex min-w-0 flex-col gap-3">
              {query.data.data.map((record) => (
                <Record key={record.id} record={record} />
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              {query.data.meta.total ? '这一页没有修改记录' : '还没有投稿策略修改记录'}
            </p>
          )}
          <nav
            aria-label="投稿记录分页"
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
              第 {input.page} 页 · 共 {new Intl.NumberFormat('zh-CN').format(query.data.meta.total)}{' '}
              条
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
    </section>
  );
}
