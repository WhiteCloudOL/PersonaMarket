'use client';
import type { GuideActionName, ManagedGuide } from '@personamarket/contracts';
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
import { Spinner } from '@personamarket/ui/components/spinner';
import { GuideBody } from './guide-body';
export function GuideConfirmation({
  action,
  snapshot,
  reason,
  busy,
  error,
  close,
  submit,
  restoreFocus,
}: {
  action: GuideActionName | undefined;
  snapshot: ManagedGuide;
  reason: string;
  busy: boolean;
  error: Error | null;
  close: () => void;
  submit: () => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const publication = action === 'withdraw' ? snapshot.published : snapshot;
  return (
    <AlertDialog
      open={Boolean(action)}
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <AlertDialogContent
        finalFocus={restoreFocus}
        className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col"
      >
        <AlertDialogHeader className="shrink-0">
          <AlertDialogTitle>
            {action === 'withdraw' ? '撤回公开指南' : '确认发布指南'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {action === 'withdraw'
              ? '撤回后，目录、独立文章和站点地图停止展示此章节'
              : '核对已保存的编辑稿，确认后立即公开'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div
          role="region"
          tabIndex={0}
          aria-label="指南操作预览"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain rounded-lg [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
        >
          <p className="text-sm text-muted-foreground">核对修订 {snapshot.revision}</p>
          <h3 className="font-semibold">{publication?.title}</h3>
          {publication?.summary && (
            <p className="text-sm text-muted-foreground">{publication.summary}</p>
          )}
          {publication && <GuideBody text={publication.bodyMarkdown} />}
          <p className="whitespace-pre-wrap text-sm">处理理由：{reason}</p>
          <FormNotice error={error} />
        </div>
        <AlertDialogFooter className="shrink-0">
          <AlertDialogCancel disabled={busy}>返回编辑</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            variant={action === 'withdraw' ? 'destructive' : 'default'}
            onClick={submit}
          >
            {busy && <Spinner aria-hidden className="motion-reduce:animate-none" />}
            {busy ? '正在处理…' : action === 'withdraw' ? '确认撤回' : '确认发布'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
