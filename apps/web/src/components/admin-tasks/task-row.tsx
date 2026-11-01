'use client';
import Link from 'next/link';
import { useState, type RefObject } from 'react';
import type { AdminTaskFailure } from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { taskDate, taskName, taskReasons, taskStageName } from './task-fields';
import { TaskRetryPanel } from './retry-panel';
import { usePathname, useSearchParams } from 'next/navigation';
import { taskHref, taskTargetForRow } from './task-command-state';

export function TaskRow({
  task,
  accountId,
  onUpdated,
  returnFocus,
}: {
  task: AdminTaskFailure;
  accountId: string;
  onUpdated: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const name = taskName(task);
  const pathname = usePathname(),
    search = useSearchParams(),
    exactTarget = taskTargetForRow(task);
  const supported = task.source === 'image' || task.source === 'market_image';
  const [open, setOpen] = useState(false),
    [visited, setVisited] = useState(false),
    [pending, setPending] = useState(false),
    [refreshOnClose, setRefreshOnClose] = useState(false);
  function finish() {
    setRefreshOnClose(true);
    setOpen(false);
  }
  return (
    <li className="grid min-w-0 items-center gap-4 py-5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{name}</h3>
          <Badge variant="secondary">{taskStageName(task.stage)}</Badge>
        </div>
        <p className="text-sm text-pretty text-muted-foreground">{taskReasons[task.errorCode]}</p>
        <time className="text-sm text-muted-foreground" dateTime={task.createdAt}>
          {taskDate(task.createdAt)} · 北京时间
        </time>
      </div>
      {exactTarget ? (
        <Link
          href={taskHref(pathname, search.toString(), exactTarget)}
          scroll={false}
          className={buttonVariants({
            variant: 'outline',
            className: 'justify-self-start sm:justify-self-end',
          })}
          aria-label={'查看' + name + '详情'}
        >
          查看详情
        </Link>
      ) : (
        <Sheet
          open={open}
          onOpenChange={(value) => {
            if (pending) return;
            setOpen(value);
            if (value) {
              setVisited(true);
              setRefreshOnClose(false);
            }
          }}
          onOpenChangeComplete={(value) => {
            if (!value && refreshOnClose) onUpdated();
          }}
        >
          <SheetTrigger
            render={<Button variant="outline" className="justify-self-start sm:justify-self-end" />}
            aria-label={'查看' + name + '详情'}
          >
            查看详情
          </SheetTrigger>
          <SheetContent
            className="sm:max-w-xl"
            keepMounted={supported && visited}
            showCloseButton={!pending}
            finalFocus={() => (refreshOnClose ? returnFocus.current : true)}
          >
            <SheetHeader>
              <SheetTitle>{name}</SheetTitle>
              <SheetDescription>
                {supported
                  ? '先核对原任务，再创建处理请求，实际结果以业务状态为准'
                  : taskReasons[task.errorCode]}
              </SheetDescription>
            </SheetHeader>
            <div className="flex min-w-0 flex-col gap-6 px-4 pb-6">
              {supported ? (
                visited && (
                  <TaskRetryPanel
                    task={task}
                    accountId={accountId}
                    active={open}
                    onPendingChange={setPending}
                    onCreated={() => setRefreshOnClose(true)}
                    onFinish={finish}
                  />
                )
              ) : (
                <>
                  <dl className="grid min-w-0 gap-4">
                    <div>
                      <dt className="text-sm text-muted-foreground">当前阶段</dt>
                      <dd>{taskStageName(task.stage)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">创建时间</dt>
                      <dd>{taskDate(task.createdAt)} · 北京时间</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">分发尝试</dt>
                      <dd>
                        {task.dispatchAttempts === null ? '未记录' : task.dispatchAttempts + ' 次'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">执行尝试</dt>
                      <dd>
                        {task.executionAttempts === null
                          ? '未记录'
                          : task.executionAttempts + ' 次'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">错误码</dt>
                      <dd className="[overflow-wrap:anywhere]">{task.errorCode}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">任务标识</dt>
                      <dd className="[overflow-wrap:anywhere]">{task.id}</dd>
                    </div>
                  </dl>
                  <p className="text-sm text-muted-foreground">
                    队列完成不代表业务成功，分发和执行的尝试次数分别记录，无法确认的次数显示为未记录
                  </p>
                </>
              )}
              {task.source === 'notification' && (
                <Link
                  href={'/admin/notifications?deliveryId=' + encodeURIComponent(task.id)}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  打开通知管理
                </Link>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </li>
  );
}
