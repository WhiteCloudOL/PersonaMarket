'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { IdSchema, type NotificationDeliveryDetail } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@personamarket/ui/components/alert-dialog';
import { FormNotice } from '../auth/auth-fields';
import { NotificationFailureList } from './failures';
import { NoticeContent } from './notice-content';
import { useDeliveryRetry } from './use-delivery-retry';
import {
  deliveryStateText,
  notificationHref,
  notificationKinds,
  notificationAttemptText,
  notificationTimestamp,
} from './delivery-state';

export function NotificationDeliveryPanel({ accountId }: { accountId: string }) {
  const search = useSearchParams(),
    pathname = usePathname(),
    router = useRouter();
  const raw = search.get('deliveryId'),
    parsed = IdSchema.safeParse(raw);
  const id = parsed.success ? parsed.data.toLowerCase() : undefined;
  const mode = raw !== null ? 'detail' : search.has('failuresPage') ? 'failures' : 'closed';
  const [pendingCommand, setPendingCommand] = useState<{ id: string; owner: string }>();
  const [returnId, setReturnId] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null),
    opener = useRef<HTMLElement | null>(null);
  const focusedView = useRef<string | undefined>(undefined);
  const pending = pendingCommand !== undefined && pendingCommand.id === id;
  useEffect(() => {
    const view = mode + ':' + raw;
    if (focusedView.current === view) return;
    focusedView.current = view;
    if (mode !== 'closed' && !returnId) heading.current?.focus();
  }, [mode, raw, returnId]);
  function close() {
    if (pending) return;
    if (mode === 'detail' && search.has('failuresPage')) {
      // Keep focus on a stable element while the detail controls unmount.
      heading.current?.focus({ preventScroll: true });
      setReturnId(id);
    }
    router.push(
      notificationHref(
        pathname,
        search.toString(),
        mode === 'detail' ? { deliveryId: undefined } : { failuresPage: undefined },
      ),
      { scroll: false },
    );
  }
  return (
    <Sheet
      open={mode !== 'closed'}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <SheetContent
        className="sm:max-w-xl"
        showCloseButton={!pending}
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
        finalFocus={() =>
          opener.current?.isConnected
            ? opener.current
            : (document.querySelector<HTMLElement>('[data-notification-management-return]') ?? true)
        }
      >
        <SheetHeader>
          <SheetTitle ref={heading} tabIndex={-1}>
            {mode === 'detail' ? '通知投递详情' : '业务通知失败任务'}
          </SheetTitle>
          <SheetDescription>
            {mode === 'detail'
              ? '先核对这条通知的当前处理结果，再决定是否重新投递'
              : '仅显示接收账号、通知类型和投递状态，原文和私有内容不在此展示'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-6">
          {mode === 'detail' && search.has('failuresPage') && (
            <Button variant="ghost" disabled={pending} onClick={close}>
              返回失败任务
            </Button>
          )}
          {mode === 'detail' ? (
            id ? (
              <DeliveryView
                key={accountId + ':' + id}
                accountId={accountId}
                id={id}
                onPendingChange={(value, owner) =>
                  setPendingCommand((previous) =>
                    value ? { id, owner } : previous?.owner === owner ? undefined : previous,
                  )
                }
              />
            ) : (
              <>
                <FormNotice error="通知定位参数无效，请移除定位后重新选择真实记录" />
                <Button onClick={close}>移除无效定位</Button>
              </>
            )
          ) : (
            mode === 'failures' && (
              <NotificationFailureList
                accountId={accountId}
                returnId={returnId}
                onReturned={() => setReturnId(undefined)}
              />
            )
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DeliveryView({
  accountId,
  id,
  onPendingChange,
}: {
  accountId: string;
  id: string;
  onPendingChange: (pending: boolean, owner: string) => void;
}) {
  const owner = useId();
  const latest = useRef<HTMLButtonElement>(null),
    retryButton = useRef<HTMLButtonElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false),
    [resolved, setResolved] = useState(false);
  const [basis, setBasis] = useState<NotificationDeliveryDetail>();
  const flow = useDeliveryRetry(
    accountId,
    id,
    () => {
      setResolved(true);
      setConfirmOpen(false);
    },
    (value) => onPendingChange(value, owner),
  );
  const { current, query, draft } = flow;
  useEffect(() => {
    if (resolved && !confirmOpen && !flow.write.isPending) latest.current?.focus();
  }, [resolved, confirmOpen, flow.write.isPending]);
  const status = current ? deliveryStateText(current) : undefined;
  const command = draft?.command;
  return (
    <>
      <Button
        ref={latest}
        variant="outline"
        disabled={flow.busy}
        aria-busy={query.isFetching}
        onClick={() => {
          if (!query.isFetching) void query.refetch();
        }}
      >
        核对当前投递状态
      </Button>
      {query.isFetching || query.isPending ? (
        <Skeleton aria-label="正在核对通知投递状态" className="h-40 w-full" />
      ) : query.isError ? (
        <>
          <FormNotice error={query.error} />
          <p className="text-sm text-muted-foreground">
            {draft?.command
              ? '暂时无法读取当前结果，原请求仍可单独核对'
              : '当前没有此对象的原请求；请关闭详情后重新选择真实记录'}
          </p>
        </>
      ) : (
        current &&
        status && (
          <>
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{notificationKinds[current.kind]}</Badge>
                <span className="text-sm text-muted-foreground">修订 {current.revision}</span>
              </div>
              <p className="text-base [overflow-wrap:anywhere]">
                接收账号 {current.recipient.username}
              </p>
              <p className="text-sm text-muted-foreground">
                本次观测：
                {query.data?.meta.observedAt ? (
                  <time dateTime={query.data.meta.observedAt}>
                    {notificationTimestamp(query.data.meta.observedAt)}
                  </time>
                ) : (
                  '未记录'
                )}
              </p>
            </div>
            <Alert aria-live="polite">
              <AlertTitle>{status.title}</AlertTitle>
              <AlertDescription>{status.description}</AlertDescription>
            </Alert>
            {current.requiresRecentVerification && current.retryAllowed && (
              <p className="text-sm text-muted-foreground">
                这是账号安全通知；若近期身份已过期，会在当前页面要求验证
              </p>
            )}
          </>
        )
      )}
      {draft && (
        <section aria-label="原重投请求" className="flex min-w-0 flex-col gap-3">
          <Alert aria-live="polite">
            <AlertTitle>{command?.accepted ? '原请求已受理' : '原请求已保留'}</AlertTitle>
            <AlertDescription>{draft.message ?? '关闭或返回不会自动重新投递'}</AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground">
            原请求基于修订 {command?.input.expectedRevision}，
            {command?.scope === 'notice' ? '管理员通知' : '业务通知'}专用操作
          </p>
          {draft.receipt && (
            <p className="text-sm text-muted-foreground" role="status">
              {draft.receipt.recorded && draft.receipt.recordedAt ? (
                <>
                  <span>回执记录时间：</span>
                  <time dateTime={draft.receipt.recordedAt}>
                    {notificationTimestamp(draft.receipt.recordedAt)}
                  </time>
                </>
              ) : (
                '本次核对未找到该原请求回执；这不排除迟到请求'
              )}
            </p>
          )}
          <Button variant="outline" disabled={flow.busy} onClick={flow.checkOriginal}>
            {flow.receipt.isPending ? '正在核对原请求…' : '核对原请求'}
          </Button>
          {command && !command.accepted && (
            <Button
              variant="outline"
              disabled={flow.busy || !current?.retryAllowed}
              onClick={flow.repeat}
            >
              明确重试原请求
            </Button>
          )}
          <FormNotice error={flow.receipt.error} />
        </section>
      )}
      <FormNotice error={flow.write.error} />
      {current && flow.canStart && (
        <Button
          ref={retryButton}
          disabled={flow.busy || query.isFetching}
          onClick={() => {
            flow.write.reset();
            setBasis(structuredClone(current));
            setResolved(false);
            setConfirmOpen(true);
          }}
        >
          {draft ? '基于当前修订重新确认' : '重试投递'}
        </Button>
      )}
      {query.data?.data.scope === 'notice' && (
        <NoticeContent accountId={accountId} id={id} available={current?.scope === 'notice'} />
      )}
      {current && (
        <Collapsible className="min-w-0">
          <CollapsibleTrigger
            render={<Button variant="ghost" />}
            className="h-auto min-h-11 whitespace-normal"
          >
            查看技术详情与口径
          </CollapsibleTrigger>
          <CollapsibleContent>
            <dl className="grid min-w-0 gap-4 py-4 sm:grid-cols-2">
              <Fact label="原始业务状态" value={current.status} />
              <Fact label="分发尝试" value={notificationAttemptText(current.dispatchAttempts)} />
              <Fact
                label="消费执行尝试"
                value={notificationAttemptText(current.executionAttempts)}
              />
              <Fact
                label="当前事件消费回执"
                value={current.currentEventProcessed ? '已记录（须与业务终态一同核对）' : '未记录'}
              />
              <Fact label="创建时间" value={notificationTimestamp(current.createdAt)} />
              <Fact
                label="本轮完成时间"
                value={
                  current.completedAt ? notificationTimestamp(current.completedAt) : '尚未完成'
                }
              />
              <Fact label="错误码" value={current.errorCode ?? '无记录'} />
              <Fact label="通知标识" value={current.id} />
              <Fact label="当前事件标识" value={current.eventId} />
            </dl>
            <p className="text-sm leading-6 text-muted-foreground">
              分发与消费执行次数分别记录，未知不作零；原请求回执与当前事件可能属于不同轮次，队列完成或失败列表消失不能证明通知已送达
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(value) => {
          if (!flow.write.isPending) setConfirmOpen(value);
        }}
      >
        <AlertDialogContent
          finalFocus={() => (resolved ? latest.current : (retryButton.current ?? latest.current))}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>确认重新投递这条通知</AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              接收账号 {basis?.recipient.username}，依据修订 {basis?.revision}
              ，原通知内容保持不变，系统会重新核对接收资格并记录本次操作；受理不代表送达
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={flow.write.isPending}>返回核对</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                flow.write.isPending ||
                !current ||
                !flow.canStart ||
                !basis ||
                current.revision !== basis.revision ||
                current.eventId !== basis.eventId ||
                current.status !== basis.status ||
                current.scope !== basis.scope
              }
              onClick={(event) => {
                event.preventDefault();
                if (basis) flow.submitNew(basis);
              }}
            >
              {flow.write.isPending ? '正在受理…' : '确认重投'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="[overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
