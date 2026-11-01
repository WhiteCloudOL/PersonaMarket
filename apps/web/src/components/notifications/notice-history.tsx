'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AdminNoticesQuerySchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@personamarket/ui/components/select';

import { notificationsApi, notificationsKey } from '@/lib/notifications-api';
import { FormNotice } from '../auth/auth-fields';
import { announcementDate } from '../announcements/announcement-content';
import { NotificationFailures } from './failures';
import { RetryDelivery } from './retry-delivery';
import { NotificationPagination } from './pagination';
import { notificationHref } from './delivery-state';

const statuses = {
  all: '全部状态',
  queued: '排队中',
  delivered: '已送达',
  skipped: '已跳过',
  failed: '投递待核对',
};
export function NoticeHistory({ accountId }: { accountId: string }) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const parsed = AdminNoticesQuerySchema.safeParse({
    page: search.get('page') ?? 1,
    status: search.get('status') ?? 'all',
    ...(search.has('recipientId') ? { recipientId: search.get('recipientId') } : {}),
  });
  const input = parsed.success ? parsed.data : undefined;
  const query = useQuery({
    queryKey: [...notificationsKey(accountId), 'history', input ?? search.toString()],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('通知筛选条件无效');
      return notificationsApi.history(accountId, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  function change(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch))
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    router.push(pathname + (next.size ? '?' + next : ''), { scroll: false });
  }
  return (
    <section aria-label="通知投递记录" className="flex min-w-0 max-w-5xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>已创建的通知</CardTitle>
          <CardDescription>记录管理员创建的通知，送达状态由后台实际处理结果更新</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {input ? (
            <>
              <Select
                items={Object.entries(statuses).map(([value, label]) => ({ value, label }))}
                value={input.status}
                onValueChange={(value) => {
                  if (value) change({ status: value, page: undefined });
                }}
              >
                <SelectTrigger aria-label="投递状态" className="min-w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {Object.entries(statuses).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                刷新投递记录
              </Button>
              {input.recipientId && (
                <Button
                  variant="ghost"
                  onClick={() => change({ recipientId: undefined, page: undefined })}
                >
                  显示所有收件人
                </Button>
              )}
            </>
          ) : (
            <>
              <FormNotice error="通知筛选条件无效，请清空筛选后重试" />
              <Button
                onClick={() =>
                  router.replace(
                    notificationHref(pathname, search.toString(), {
                      page: undefined,
                      status: undefined,
                      recipientId: undefined,
                    }),
                  )
                }
              >
                清空筛选
              </Button>
            </>
          )}
        </CardContent>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {input &&
            (query.isPending ? (
              <Skeleton className="h-64 w-full" />
            ) : query.isError ? (
              <>
                <FormNotice error={query.error} />
                <Button onClick={() => void query.refetch()}>重试读取投递记录</Button>
              </>
            ) : (
              <>
                {query.data.data.length ? (
                  <ul className="flex min-w-0 flex-col divide-y">
                    {query.data.data.map((row) => (
                      <li
                        key={row.id}
                        aria-label={'投递记录：' + row.title}
                        className="grid min-w-0 items-start gap-3 py-5 sm:grid-cols-[fit-content(48rem)_max-content] sm:justify-start"
                      >
                        <div className="flex min-w-0 flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">
                              {row.status === 'failed' ? '需要核对' : statuses[row.status]}
                            </Badge>
                            <CardDescription>{announcementDate(row.createdAt)}</CardDescription>
                          </div>
                          <h3 className="text-base font-medium [overflow-wrap:anywhere]">
                            {row.title}
                          </h3>
                          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                            收件人 {row.recipient.username} · 创建人 {row.actor.username}
                          </p>
                        </div>
                        <div className="justify-self-start sm:justify-self-end">
                          <RetryDelivery entry={row} />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                      没有符合条件的投递记录
                    </CardContent>
                  </Card>
                )}
                <NotificationPagination
                  page={input.page}
                  total={query.data.meta.total}
                  busy={query.isFetching}
                  change={(page) => change({ page: String(page) })}
                />
              </>
            ))}
        </CardContent>
      </Card>
      <NotificationFailures />
    </section>
  );
}
