'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { Separator } from '@personamarket/ui/components/separator';
import { FormNotice } from '../auth/auth-fields';
import { adminPersonasApi, adminPersonasKey } from '@/lib/admin-personas-api';
import { AdminPersonaRecords } from './admin-persona-records';
import { CurationForm } from './curation-form';
import { PersonaModerationForm } from './persona-moderation-form';
import { AdminDeleteDialog } from '../admin/admin-delete-dialog';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { retainsPersonaPanelDraft } from '@/lib/admin-personas-state';
export function AdminPersonaDetail({
  accountId,
  id,
  open,
  close,
  onDirty,
}: {
  accountId: string;
  id: string;
  open: boolean;
  close: () => void;
  onDirty: (value: boolean) => void;
}) {
  const client = useQueryClient();
  const [curationDirty, setCurationDirty] = useState(false);
  const [moderationDirty, setModerationDirty] = useState(false);
  const [curationBusy, setCurationBusy] = useState(false);
  const [moderationBusy, setModerationBusy] = useState(false);
  const dirty = curationDirty || moderationDirty;
  const busy = curationBusy || moderationBusy;
  useUnsavedDraft(dirty || busy, '还有未保存的人设管理操作，确定离开吗', retainsPersonaPanelDraft);
  const query = useQuery({
    queryKey: [...adminPersonasKey(accountId), 'detail', id],
    queryFn: ({ signal }) => adminPersonasApi.detail(accountId, id, signal),
    enabled: open,
    retry: false,
  });
  useEffect(() => {
    onDirty(dirty || busy);
    return () => onDirty(false);
  }, [dirty, busy, onDirty]);
  const item = query.data?.data;
  function requestClose() {
    if (!busy && (!dirty || window.confirm('尚有未保存的管理操作，确定关闭吗'))) close();
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) requestClose();
      }}
    >
      <SheetContent className="sm:max-w-xl" showCloseButton={!busy} keepMounted>
        <SheetHeader>
          <SheetTitle>管理人设</SheetTitle>
          <SheetDescription>查看版本和公开状态，核对后再保存管理操作</SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-6 sm:px-5">
          {!item && query.isPending ? (
            <Skeleton className="h-52 w-full" />
          ) : !item && query.isError ? (
            <>
              <FormNotice error={query.error} />
              <Button onClick={() => void query.refetch()}>重新读取人设</Button>
            </>
          ) : (
            item && (
              <>
                {query.isError && <FormNotice error={query.error} />}
                <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
                  {item.title || '未命名人设'}
                </h2>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">作者</dt>
                  <dd className="min-w-0 break-all">
                    <Link
                      href={'/admin/users?userId=' + item.owner.id}
                      className="underline underline-offset-4"
                    >
                      {item.owner.username}
                    </Link>
                  </dd>
                  <dt className="text-muted-foreground">平台</dt>
                  <dd>{item.platform === 'maibot' ? 'MaiBot' : 'AstrBot'}</dd>
                  <dt className="text-muted-foreground">公开状态</dt>
                  <dd>
                    {item.moderationState === 'blocked'
                      ? '已下架'
                      : item.ownerVisibility === 'hidden'
                        ? '作者隐藏'
                        : item.publiclyVisible
                          ? '公开展示'
                          : '未公开'}
                  </dd>
                  <dt className="text-muted-foreground">待审版本</dt>
                  <dd>{item.pendingCount}</dd>
                  <dt className="text-muted-foreground">人设 ID</dt>
                  <dd className="min-w-0 break-all">{item.id}</dd>
                </dl>
                <div className="flex flex-wrap gap-2">
                  {item.publiclyVisible && (
                    <Link
                      href={'/personas/' + id}
                      className={buttonVariants({ variant: 'outline' })}
                    >
                      查看公开版本
                    </Link>
                  )}
                  {item.publishedSubmissionId && (
                    <Link
                      href={'/admin/moderation?submission=' + item.publishedSubmissionId}
                      className={buttonVariants({ variant: 'outline' })}
                    >
                      查看发布快照
                    </Link>
                  )}
                  {item.latestPendingSubmissionId && (
                    <Link
                      href={'/admin/moderation?submission=' + item.latestPendingSubmissionId}
                      className={buttonVariants({ variant: 'outline' })}
                    >
                      查看待审版本
                    </Link>
                  )}
                </div>
                <Separator />
                <CurationForm
                  initial={item}
                  accountId={accountId}
                  onDirty={setCurationDirty}
                  onBusy={setCurationBusy}
                  locked={moderationBusy}
                  changed={() =>
                    client.invalidateQueries({ queryKey: adminPersonasKey(accountId) })
                  }
                />
                <Separator />
                <PersonaModerationForm
                  initial={item}
                  accountId={accountId}
                  onDirty={setModerationDirty}
                  onBusy={setModerationBusy}
                  locked={curationBusy}
                  changed={() =>
                    client.invalidateQueries({ queryKey: adminPersonasKey(accountId) })
                  }
                />
                <Separator />
                <AdminDeleteDialog
                  accountId={accountId}
                  target={{ kind: 'persona', id, label: item.title, revision: item.revision }}
                  disabled={busy || dirty}
                  deleted={() => {
                    onDirty(false);
                    close();
                  }}
                />
                <AdminPersonaRecords accountId={accountId} id={id} />
                <Button variant="outline" type="button" onClick={requestClose} disabled={busy}>
                  关闭管理面板
                </Button>
              </>
            )
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
