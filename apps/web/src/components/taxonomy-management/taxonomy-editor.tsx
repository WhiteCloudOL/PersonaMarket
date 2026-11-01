'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaxonomyKind } from '@personamarket/contracts';
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
import { taxonomyManagementApi, taxonomyManagementKey } from '@/lib/taxonomy-management-api';
import { TaxonomyEntryForm } from './taxonomy-entry-form';
import { TaxonomyRecords } from './taxonomy-records';

export function TaxonomyEditor({
  accountId,
  kind,
  id,
  open,
  close,
  onDirty,
  notify,
}: {
  accountId: string;
  kind: TaxonomyKind;
  id: string;
  open: boolean;
  close: () => void;
  onDirty: (value: boolean) => void;
  notify: (message: string) => void;
}) {
  const client = useQueryClient();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useUnsavedDraft(dirty || busy, '还有未保存的目录操作，确定离开吗');
  useEffect(() => {
    onDirty(dirty || busy);
    return () => onDirty(false);
  }, [dirty, busy, onDirty]);
  const query = useQuery({
    queryKey: [...taxonomyManagementKey(accountId, kind), 'detail', id],
    queryFn: ({ signal }) => taxonomyManagementApi.detail(accountId, kind, id, signal),
    enabled: open && id !== 'new',
    retry: false,
  });
  const item = query.data?.data;
  function requestClose() {
    if (!busy && (!dirty || window.confirm('尚有未保存的目录操作，确定关闭吗'))) close();
  }
  async function saved() {
    if (!alive.current) return;
    await client.invalidateQueries({ queryKey: taxonomyManagementKey(accountId, kind) });
    await client.invalidateQueries({ queryKey: ['site', 'taxonomy'] });
    if (!alive.current) return;
    notify('目录操作已处理，请核对当前状态');
    close();
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) requestClose();
      }}
    >
      <SheetContent keepMounted showCloseButton={!busy} className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>管理{kind === 'category' ? '分类' : '标签'}</SheetTitle>
          <SheetDescription>目录调整影响后续选择，旧版本保留送审时的名称</SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-6 sm:px-5">
          {id !== 'new' && !item && query.isPending ? (
            <Skeleton className="h-56 w-full" />
          ) : id !== 'new' && !item ? (
            <>
              <FormNotice error={query.error ?? new Error('条目不存在或暂时无法读取')} />
              <Button onClick={() => void query.refetch()}>重新读取目录</Button>
            </>
          ) : (
            <>
              {item && (
                <>
                  <p className="text-sm [overflow-wrap:anywhere]">条目 ID：{item.id}</p>
                  <p className="text-sm text-muted-foreground">
                    草稿引用 {query.data?.usage.drafts} 条 · 版本引用{' '}
                    {query.data?.usage.submissions} 条，归档时会重新核对
                  </p>
                  <Separator />
                </>
              )}
              <TaxonomyEntryForm
                initial={item ?? null}
                accountId={accountId}
                kind={kind}
                onDirty={setDirty}
                onBusy={setBusy}
                saved={saved}
              />
              {item && (
                <>
                  <Separator />
                  <TaxonomyRecords accountId={accountId} kind={kind} id={item.id} active={open} />
                </>
              )}
            </>
          )}
          <Button type="button" variant="outline" onClick={requestClose} disabled={busy}>
            关闭面板
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
