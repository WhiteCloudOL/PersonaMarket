'use client';
import type { z } from 'zod';
import type { AdminTaskRetryHistoryResponseSchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { taskDate } from './task-fields';

export function RetryHistoryError({
  error,
  retry,
  pending,
}: {
  error: Error;
  retry: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert variant="destructive">
        <AlertTitle>人工处理记录读取未完成</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
      <Button type="button" variant="outline" disabled={pending} onClick={retry}>
        重新读取记录
      </Button>
    </div>
  );
}
export function RetryHistory({
  value,
}: {
  value: z.infer<typeof AdminTaskRetryHistoryResponseSchema>;
}) {
  if (!value.data.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>任务中心尚无人工处理记录</EmptyTitle>
          <EmptyDescription>队列自动尝试和原业务操作不计入这里</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <ol aria-label="任务中心人工处理记录" className="flex min-w-0 flex-col divide-y">
      {value.data.map((record) => (
        <li key={record.id} className="flex min-w-0 flex-col gap-3 py-4 first:pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">第 {record.attempt} 次人工重试</p>
            <time className="text-sm text-muted-foreground" dateTime={record.createdAt}>
              {taskDate(record.createdAt)}
            </time>
          </div>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{record.reason}</p>
          <Collapsible>
            <CollapsibleTrigger render={<Button type="button" variant="ghost" />}>
              查看审计标识
            </CollapsibleTrigger>
            <CollapsibleContent>
              <dl className="grid min-w-0 gap-3 pt-3 text-sm">
                {[
                  ['操作记录', record.id],
                  ['操作者', record.actorId],
                  ['原事件', record.previousEventId ?? '未记录'],
                  ['新事件', record.eventId],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="[overflow-wrap:anywhere]">{value}</dd>
                  </div>
                ))}
              </dl>
            </CollapsibleContent>
          </Collapsible>
        </li>
      ))}
    </ol>
  );
}
