'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { Button } from '@personamarket/ui/components/button';
import { Separator } from '@personamarket/ui/components/separator';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { FormNotice } from '../auth/auth-fields';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { announcementsApi, announcementsKey } from '@/lib/announcements-api';
import { AnnouncementForm } from './form';
import { AnnouncementRecords } from './records';
import { AnnouncementBody } from './announcement-content';
export function AnnouncementEditor({
  accountId,
  id,
  open,
  close,
  onDirty,
  notify,
}: {
  accountId: string;
  id: string;
  open: boolean;
  close: () => void;
  onDirty: (value: boolean) => void;
  notify: (message: string) => void;
}) {
  const client = useQueryClient();
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useUnsavedDraft(dirty || busy, '还有未保存的公告操作，确定离开吗');
  useEffect(() => {
    onDirty(dirty || busy);
    return () => onDirty(false);
  }, [dirty, busy, onDirty]);
  const query = useQuery({
    queryKey: [...announcementsKey(accountId), 'detail', id],
    queryFn: ({ signal }) => announcementsApi.detail(accountId, id, signal),
    enabled: open && id !== 'new',
    retry: false,
  });
  const item = query.data?.data;
  function requestClose() {
    if (!busy && (!dirty || window.confirm('尚有未保存的公告操作，确定关闭吗'))) close();
  }
  async function saved() {
    if (!alive.current) return;
    await client.invalidateQueries({ queryKey: announcementsKey(accountId) });
    if (!alive.current) return;
    notify('公告操作已处理，请核对当前状态');
    close();
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) requestClose();
      }}
    >
      <SheetContent keepMounted showCloseButton={!busy} className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>管理公告</SheetTitle>
          <SheetDescription>保存编辑稿后再确认发布，未发布文字仅对管理员可见</SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-6 sm:px-5">
          {id !== 'new' && !item && query.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : id !== 'new' && !item ? (
            <>
              <FormNotice error={query.error ?? new Error('公告暂时无法读取')} />
              <Button onClick={() => void query.refetch()}>重新读取公告</Button>
            </>
          ) : (
            <>
              {item && (
                <>
                  <p className="text-sm [overflow-wrap:anywhere]">公告 ID：{item.id}</p>
                  {item.status === 'published' && (
                    <p role="status" className="text-sm text-muted-foreground">
                      {item.hasUnpublishedChanges
                        ? '当前公告展示上次发布内容，新的编辑稿尚未公开'
                        : '当前编辑稿已公开，修改后需要再次确认发布'}
                    </p>
                  )}
                  <Separator />
                </>
              )}
              <AnnouncementForm
                initial={item ?? null}
                accountId={accountId}
                onDirty={setDirty}
                onBusy={setBusy}
                saved={saved}
              />
              {item?.published && (
                <section aria-label="上次发布内容" className="flex min-w-0 flex-col gap-3">
                  <Separator />
                  <h3 className="font-semibold">上次发布内容</h3>
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label="上次发布正文"
                    className="max-h-[40dvh] overflow-y-auto overscroll-contain rounded-lg border border-border p-3 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <h4 className="mb-3 font-medium [overflow-wrap:anywhere]">
                      {item.published.title}
                    </h4>
                    <AnnouncementBody body={item.published.body} />
                  </div>
                </section>
              )}
              {item && (
                <>
                  <Separator />
                  <AnnouncementRecords accountId={accountId} id={item.id} open={open} />
                </>
              )}
            </>
          )}
          <Button type="button" variant="outline" disabled={busy} onClick={requestClose}>
            关闭面板
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
