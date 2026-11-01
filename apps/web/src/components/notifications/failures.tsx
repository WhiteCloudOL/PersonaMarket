'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { NotificationFailuresQuerySchema } from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { notificationsApi, notificationsKey } from '@/lib/notifications-api';
import { FormNotice } from '../auth/auth-fields';
import { announcementDate } from '../announcements/announcement-content';
import { RetryDelivery } from './retry-delivery';
import { NotificationPagination } from './pagination';
import { notificationHref, notificationKinds } from './delivery-state';

export function NotificationFailures() {
  const search = useSearchParams(),
    pathname = usePathname();
  return (
    <Link
      href={notificationHref(pathname, search.toString(), {
        failuresPage: '1',
        deliveryId: undefined,
      })}
      scroll={false}
      className={buttonVariants({
        variant: 'outline',
        className: 'h-auto min-h-11 whitespace-normal text-center',
      })}
      data-notification-management-return
    >
      查看业务通知失败任务
    </Link>
  );
}

export function NotificationFailureList({
  accountId,
  returnId,
  onReturned,
}: {
  accountId: string;
  returnId: string | undefined;
  onReturned: () => void;
}) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const parsed = NotificationFailuresQuerySchema.safeParse({
    page: search.get('failuresPage') ?? 1,
  });
  const input = parsed.success ? parsed.data : undefined;
  const list = useRef<HTMLUListElement>(null),
    refresh = useRef<HTMLButtonElement>(null);
  const query = useQuery({
    queryKey: [...notificationsKey(accountId), 'failures', input ?? search.toString()],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('失败任务页码无效');
      return notificationsApi.failures(accountId, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  useEffect(() => {
    if (!returnId || query.isFetching || query.isPending) return;
    const target = list.current?.querySelector<HTMLAnchorElement>(
      `[data-delivery-id="${returnId}"]`,
    );
    (target ?? refresh.current)?.focus();
    onReturned();
  }, [returnId, query.isFetching, query.isPending, onReturned]);
  function change(page: number) {
    router.push(notificationHref(pathname, search.toString(), { failuresPage: String(page) }), {
      scroll: false,
    });
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Button
        ref={refresh}
        variant="outline"
        disabled={query.isFetching}
        onClick={() => (input ? void query.refetch() : change(1))}
      >
        刷新失败任务
      </Button>
      {!input ? (
        <FormNotice error="失败任务页码无效，请刷新失败任务后重试" />
      ) : query.isPending ? (
        <Skeleton aria-label="正在读取业务通知失败任务" className="h-48 w-full" />
      ) : query.isError ? (
        <FormNotice error={query.error} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            共 {query.data.meta.total} 条失败任务
          </p>
          {query.data.data.length ? (
            <ul ref={list} className="flex min-w-0 flex-col divide-y">
              {query.data.data.map((row) => (
                <li
                  key={row.id}
                  className="flex min-w-0 flex-col items-start gap-3 py-4 first:pt-0"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <h3 className="font-medium">{notificationKinds[row.kind]}</h3>
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      接收账号 {row.recipient.username}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {announcementDate(row.createdAt)} · 本轮失败，详情中核对实际次数
                    </p>
                  </div>
                  <RetryDelivery entry={row} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-muted-foreground">
              没有待重投的业务通知；这不代表其他通知均已送达
            </p>
          )}
          <NotificationPagination
            page={input.page}
            total={query.data.meta.total}
            busy={query.isFetching}
            change={change}
          />
        </>
      )}
    </div>
  );
}
