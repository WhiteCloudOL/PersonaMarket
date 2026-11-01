'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NotificationsQuerySchema } from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { notificationsApi, notificationsKey } from '@/lib/notifications-api';
import { FormNotice } from '../auth/auth-fields';
import { announcementDate } from '../announcements/announcement-content';
import { NotificationPagination } from './pagination';
import { NotificationPreferences } from './preferences';
import { NotificationMessage } from './message';
import { cn } from '@personamarket/ui/lib/utils';

export function NotificationInbox({ accountId }: { accountId: string }) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname(),
    client = useQueryClient();
  const parsed = NotificationsQuerySchema.safeParse({
    page: search.get('page') ?? 1,
    status: search.get('status') ?? 'all',
  });
  const input = parsed.success ? parsed.data : undefined;
  const query = useQuery({
    queryKey: [...notificationsKey(accountId), 'inbox', input ?? search.toString()],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('通知筛选条件无效');
      return notificationsApi.list(accountId, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  const read = useMutation({
    mutationFn: (command: { id: string; all: boolean }) =>
      command.all
        ? notificationsApi.readAll(accountId, command.id)
        : notificationsApi.read(accountId, command.id),
    retry: false,
    onSuccess: () => client.invalidateQueries({ queryKey: notificationsKey(accountId) }),
  });
  function change(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch))
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    router.push(pathname + (next.size ? '?' + next : ''), { scroll: false });
  }
  if (!input)
    return (
      <>
        <FormNotice error="通知筛选条件无效，请清空筛选后重试" />
        <Button onClick={() => router.replace(pathname)}>清空筛选</Button>
      </>
    );
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <ToggleGroup
            variant="selection"
            className="flex-wrap"
            aria-label="通知筛选"
            value={[input.status]}
            disabled={read.isPending}
            onValueChange={([status]) => {
              if (status === 'all' || status === 'unread') change({ status, page: undefined });
            }}
          >
            {(['all', 'unread'] as const).map((status) => (
              <ToggleGroupItem key={status} value={status} className="min-h-11 px-4">
                {status === 'all' ? '全部通知' : '只看未读'}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {query.data ? `${query.data.meta.unreadCount} 条未读` : '正在读取通知…'}
            </span>
            <Button
              variant="outline"
              disabled={query.isFetching || read.isPending}
              onClick={() => void query.refetch()}
            >
              刷新通知
            </Button>
            <Button
              variant="secondary"
              disabled={
                !query.data?.meta.throughId ||
                !query.data.meta.unreadCount ||
                read.isPending ||
                query.isFetching
              }
              onClick={() => {
                const id = query.data?.meta.throughId;
                if (id) read.mutate({ id, all: true });
              }}
            >
              全部已读
            </Button>
          </div>
        </CardContent>
      </Card>
      <NotificationPreferences accountId={accountId} />
      <FormNotice
        error={read.error}
        message={read.isSuccess ? '已读状态已更新，后来送达的通知保持未读' : undefined}
      />
      {query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <>
          <FormNotice error={query.error} />
          <Button onClick={() => void query.refetch()}>重试读取通知</Button>
        </>
      ) : (
        <>
          {query.data.data.length ? (
            <div
              className={cn(
                'grid min-w-0 items-start gap-4',
                query.data.data.length > 1 ? 'lg:grid-cols-2' : 'max-w-4xl',
              )}
            >
              {query.data.data.map((row) => (
                <Card key={row.id} aria-label={'通知：' + row.title}>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={row.readAt ? 'secondary' : 'default'}>
                        {row.readAt ? '已读' : '未读'}
                      </Badge>
                      <CardDescription>
                        <time dateTime={row.createdAt}>{announcementDate(row.createdAt)}</time>
                      </CardDescription>
                    </div>
                    <CardTitle className="[overflow-wrap:anywhere]">{row.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex min-w-0 flex-col gap-4">
                    <NotificationMessage message={row.message} />
                    {!row.available && (
                      <p className="text-sm text-muted-foreground">
                        相关内容已不可访问，通知记录仍保留
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {row.available && row.path && (
                        <Link
                          className={buttonVariants({ variant: 'outline' })}
                          href={row.path}
                          prefetch={false}
                        >
                          查看相关内容
                        </Link>
                      )}
                      {!row.readAt && (
                        <Button
                          variant="secondary"
                          disabled={read.isPending}
                          onClick={() => read.mutate({ id: row.id, all: false })}
                        >
                          标为已读
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {input.status === 'unread' ? '没有未读通知' : '暂时没有通知'}
                </EmptyTitle>
                <EmptyDescription>创作和互动有新进展时，会在这里提醒你</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <NotificationPagination
            page={input.page}
            total={query.data.meta.total}
            busy={query.isFetching || read.isPending}
            change={(page) => change({ page: String(page) })}
          />
        </>
      )}
    </div>
  );
}
