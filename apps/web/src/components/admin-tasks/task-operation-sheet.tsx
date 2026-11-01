'use client';
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@personamarket/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { FormNotice } from '../auth/auth-fields';
import { parseExactTaskTarget, taskHref } from './task-command-state';
import { RankingRetryPanel } from './ranking-retry-panel';
import { OperationalTaskPanel } from './operational-task-panel';

export function TaskOperationSheet({
  accountId,
  returnFocus,
}: {
  accountId: string;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const search = useSearchParams(),
    pathname = usePathname(),
    router = useRouter(),
    raw = search.get('task'),
    target = parseExactTaskTarget(raw);
  const heading = useRef<HTMLHeadingElement>(null),
    opener = useRef<HTMLElement | null>(null),
    focused = useRef<string | undefined>(undefined);
  const [pending, setPending] = useState<{ owner: string; target: string }>();
  const handlePending = useCallback(
    (value: boolean, owner: string, task: string) =>
      setPending((previous) =>
        value ? { owner, target: task } : previous?.owner === owner ? undefined : previous,
      ),
    [],
  );
  const identity = target ? target.kind + ':' + target.id : raw;
  const busy = Boolean(pending && pending.target === identity);
  useEffect(() => {
    if (raw === null || focused.current === raw) return;
    focused.current = raw;
    heading.current?.focus();
  }, [raw]);
  function close() {
    if (busy) return;
    router.push(taskHref(pathname, search.toString(), undefined), { scroll: false });
  }
  const title =
    target?.kind === 'ranking'
      ? '榜单生成详情'
      : target?.kind === 'storage'
        ? '文件清理核对'
        : target?.kind === 'mail'
          ? '邮件任务核对'
          : '任务定位无效';
  return (
    <Sheet
      open={raw !== null}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <SheetContent
        className="sm:max-w-xl"
        showCloseButton={!busy}
        initialFocus={() => {
          if (
            document.activeElement instanceof HTMLElement &&
            document.activeElement.matches(
              'a[href],button:not(:disabled),input:not(:disabled),[tabindex]:not([tabindex="-1"])',
            ) &&
            !document.activeElement.closest('[data-slot="sheet-content"]')
          )
            opener.current = document.activeElement;
          return heading.current ?? true;
        }}
        finalFocus={() => (opener.current?.isConnected ? opener.current : returnFocus.current)}
      >
        <SheetHeader>
          <SheetTitle ref={heading} tabIndex={-1}>
            {title}
          </SheetTitle>
          <SheetDescription>
            {target?.kind === 'mail'
              ? '核对原业务关联并追加说明，不重发邮件'
              : '先读取精确任务的当前事实，再明确确认处理；受理不代表业务完成'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-6">
          {target ? (
            <ExactTaskView
              key={accountId + ':' + target.kind + ':' + target.id}
              accountId={accountId}
              target={target}
              onPendingChange={handlePending}
            />
          ) : (
            <>
              <FormNotice error="任务定位参数无效，请移除定位后重新选择真实任务" />
              <Button onClick={close}>移除无效定位</Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
function ExactTaskView({
  accountId,
  target,
  onPendingChange,
}: {
  accountId: string;
  target: NonNullable<ReturnType<typeof parseExactTaskTarget>>;
  onPendingChange: (value: boolean, owner: string, task: string) => void;
}) {
  const owner = useId();
  const notify = useCallback(
    (value: boolean) => onPendingChange(value, owner, target.kind + ':' + target.id),
    [onPendingChange, owner, target.kind, target.id],
  );
  return target.kind === 'ranking' ? (
    <RankingRetryPanel accountId={accountId} id={target.id} active onPendingChange={notify} />
  ) : (
    <OperationalTaskPanel
      accountId={accountId}
      target={{ kind: target.kind, id: target.id }}
      active
      onPendingChange={notify}
    />
  );
}
