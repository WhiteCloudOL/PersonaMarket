'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { notificationsApi, notificationsKey } from '@/lib/notifications-api';
import { FormNotice } from '../auth/auth-fields';
import { NotificationMessage } from './message';

/** 仅已核对的管理员通知读取旧专用接口正文，不将其旧投影状态用于操作判断。 */
export function NoticeContent({
  accountId,
  id,
  available,
}: {
  accountId: string;
  id: string;
  available: boolean;
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: [...notificationsKey(accountId), 'notice-content', id],
    queryFn: ({ signal }) => notificationsApi.noticeContent(accountId, id, signal),
    enabled: open && available,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger
        render={<Button variant="ghost" />}
        disabled={!available}
        className="h-auto min-h-11 whitespace-normal"
      >
        {open ? '收起管理员通知正文' : '查看管理员通知正文'}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <section aria-label="管理员通知正文" className="flex min-w-0 flex-col gap-3 pt-3">
          {!available ? (
            <p className="text-sm text-muted-foreground">请先核对当前通知状态，再读取正文</p>
          ) : query.isPending || query.isFetching ? (
            <Skeleton aria-label="正在读取管理员通知正文" className="h-28 w-full" />
          ) : query.isError ? (
            <>
              <FormNotice error={query.error} />
              <Button variant="outline" onClick={() => void query.refetch()}>
                重试读取通知正文
              </Button>
            </>
          ) : (
            <>
              <h3 className="text-base font-medium [overflow-wrap:anywhere]">
                {query.data.data.title}
              </h3>
              <NotificationMessage message={query.data.data.message} />
            </>
          )}
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}
