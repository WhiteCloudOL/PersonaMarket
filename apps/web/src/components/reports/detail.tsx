'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { Badge } from '@personamarket/ui/components/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
import { cn } from '@personamarket/ui/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { reportsApi, reportsKey } from '@/lib/reports-api';
import { FormNotice } from '../auth/auth-fields';
import { ReportEvidence } from './snapshot';
import { ReportRecords } from './records';
import { ReportActionForm } from './action-form';
import { reportStatuses } from './labels';

export function ReportDetail({
  accountId,
  id,
  mode,
  close,
}: {
  accountId: string;
  id: string;
  mode: 'own' | 'admin';
  close: () => void;
}) {
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const query = useQuery<
    Awaited<ReturnType<typeof reportsApi.admin>> | Awaited<ReturnType<typeof reportsApi.own>>
  >({
    queryKey: [...reportsKey(accountId, mode === 'admin'), 'detail', id],
    queryFn: ({ signal }) =>
      mode === 'admin'
        ? reportsApi.admin(accountId, id, signal)
        : reportsApi.own(accountId, id, signal),
    retry: false,
  });
  function requestClose() {
    if (!busy && (!dirty || window.confirm('举报处理说明尚未保存，确定关闭吗'))) close();
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <SheetContent showCloseButton={!busy} className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{mode === 'admin' ? '处理举报' : '举报详情'}</SheetTitle>
          <SheetDescription>
            {mode === 'admin'
              ? '核对私有线索、公开内容快照和历次处理记录'
              : '查看提交时的内容和管理员的处理说明'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-5">
          <FormNotice error={query.error} />
          {!query.data && query.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : !query.data ? (
            <Button onClick={() => void query.refetch()}>重试读取举报</Button>
          ) : (
            <>
              {mode === 'admin' && (
                <div className="flex min-w-0 flex-col gap-2">
                  <Badge className="self-start">{reportStatuses[query.data.data.status]}</Badge>
                  <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
                    举报对象：{query.data.data.personaTitle}
                  </h2>
                </div>
              )}
              <Tabs
                defaultValue={mode === 'admin' ? 'process' : 'evidence'}
                className="min-w-0 gap-5"
              >
                <TabsList
                  aria-label="举报详情分区"
                  className={cn(
                    'grid h-auto min-h-11 w-full',
                    mode === 'admin' ? 'grid-cols-3' : 'grid-cols-2',
                  )}
                >
                  {mode === 'admin' && (
                    <TabsTrigger value="process" className="min-h-11">
                      处理
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="evidence" className="min-h-11">
                    {mode === 'admin' ? '线索' : '内容'}
                  </TabsTrigger>
                  <TabsTrigger value="records" className="min-h-11">
                    记录
                  </TabsTrigger>
                </TabsList>
                {mode === 'admin' && 'reporter' in query.data.data && (
                  <TabsContent value="process" keepMounted>
                    <ReportActionForm
                      accountId={accountId}
                      initial={query.data.data}
                      onDirty={setDirty}
                      onBusy={setBusy}
                    />
                  </TabsContent>
                )}
                <TabsContent value="evidence">
                  {'reporter' in query.data.data && (
                    <p className="mb-4 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      举报人：{query.data.data.reporter.username}
                    </p>
                  )}
                  <ReportEvidence report={query.data.data} mode={mode} />
                </TabsContent>
                <TabsContent value="records">
                  <ReportRecords accountId={accountId} id={id} mode={mode} />
                </TabsContent>
              </Tabs>
            </>
          )}
          <Button variant="outline" disabled={busy} onClick={requestClose}>
            关闭举报详情
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
