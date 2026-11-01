'use client';
import type { AdminTaskQueueObservation } from '@personamarket/contracts';
import { Alert, AlertDescription, AlertTitle } from '@personamarket/ui/components/alert';
import { Button } from '@personamarket/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@personamarket/ui/components/sheet';
import { taskDate } from './task-fields';

export function TaskObservationNotice({ value }: { value: AdminTaskQueueObservation }) {
  if (value.status === 'ready') return null;
  return (
    <Alert>
      <AlertTitle>
        {value.status === 'unavailable' ? '队列观测暂不可用' : '队列记录未完整读取'}
      </AlertTitle>
      <AlertDescription>
        {value.status === 'unavailable'
          ? '已展示可读取的数据库记录，当前数量不代表全部失败任务，可稍后刷新'
          : '已展示当前可核验的业务和队列记录，未匹配或超出采样范围的历史不会被当作零失败'}
      </AlertDescription>
    </Alert>
  );
}
export function TaskObservationDetails({ value }: { value: AdminTaskQueueObservation }) {
  const format = new Intl.NumberFormat('zh-CN');
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" />}>查看观测范围</SheetTrigger>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>观测范围</SheetTitle>
          <SheetDescription>以当前业务状态为准</SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-6">
          <dl className="grid gap-4">
            <div>
              <dt className="text-sm text-muted-foreground">队列采样时间</dt>
              <dd>{taskDate(value.checkedAt)} · 北京时间</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">保留失败总数</dt>
              <dd>
                {value.retainedFailed === null
                  ? '暂时无法读取'
                  : format.format(value.retainedFailed)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">本次检查</dt>
              <dd>
                {format.format(value.inspected)} 条，最多 {format.format(value.limit)} 条
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">无法核验的记录</dt>
              <dd>
                {value.status === 'unavailable'
                  ? '暂时无法确认'
                  : format.format(value.unverifiable)}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">
            队列保留失败可能属于已经完成、已经替换或无法核验的旧任务，因此不会直接作为当前业务失败数量
          </p>
          <p className="text-sm text-muted-foreground">
            邮件结果待确认时应先核对原业务和邮件记录，重新发送可能产生重复副作用
          </p>
          <p className="text-sm text-muted-foreground">
            分发和执行尝试分别展示，数据库未持久记录的次数不推算为零，队列中的错误正文和原始任务不会在这里显示
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
