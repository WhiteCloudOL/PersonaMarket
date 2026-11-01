'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GuideSlug } from '@personamarket/contracts';
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
import { guidesApi, guidesKey } from '@/lib/guides-api';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { FormNotice } from '../auth/auth-fields';
import { GuideEditorForm } from './editor-form';
import { GuideRecords } from './records';
import { guideLabel } from './guide-labels';

function retainsGuideDraft(target: URL, current: URL) {
  return (
    target.origin === current.origin &&
    target.pathname === current.pathname &&
    current.pathname === '/admin/guides'
  );
}
export function GuideEditor({
  accountId,
  slug,
  close,
}: {
  accountId: string;
  slug: GuideSlug;
  close: () => void;
}) {
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  useUnsavedDraft(dirty || busy, '指南还有未保存的输入，确定离开吗', retainsGuideDraft);
  const query = useQuery({
    queryKey: [...guidesKey(accountId), 'detail', slug],
    queryFn: ({ signal }) => guidesApi.read(accountId, slug, signal),
    retry: false,
  });
  function requestClose() {
    if (!busy && (!dirty || window.confirm('输入会在当前登录期间保留，确定关闭指南编辑吗')))
      close();
  }
  return (
    <Sheet
      open
      onOpenChange={(value) => {
        if (!value) requestClose();
      }}
    >
      <SheetContent showCloseButton={!busy} className="overflow-hidden sm:max-w-6xl">
        <SheetHeader>
          <SheetTitle>编辑指南</SheetTitle>
          <SheetDescription>{guideLabel(slug)} · 保存编辑稿后再确认发布</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-5">
          {!query.data && query.isPending ? (
            <Skeleton className="min-h-64 w-full" />
          ) : !query.data ? (
            <>
              <FormNotice error={query.error ?? new Error('指南暂时无法读取')} />
              <Button onClick={() => void query.refetch()}>重新读取指南</Button>
            </>
          ) : (
            <>
              <GuideEditorForm
                accountId={accountId}
                initial={query.data.data}
                onDirty={setDirty}
                onBusy={setBusy}
              />
              <Separator />
              <GuideRecords accountId={accountId} slug={slug} />
            </>
          )}
          <Button type="button" variant="outline" disabled={busy} onClick={requestClose}>
            关闭编辑面板
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
