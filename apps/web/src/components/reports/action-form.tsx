'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import {
  reportNextStatus,
  type AdminReport,
  type AdminReportAction,
} from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Spinner } from '@personamarket/ui/components/spinner';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { reportContentActions } from '@/lib/report-action-form';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
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
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { useReportAction } from './use-report-action';
import { reportActions, reportStatuses } from './labels';
import { ReportResolutionFields } from './resolution-fields';

export function ReportActionForm({
  accountId,
  initial,
  onDirty,
  onBusy,
}: {
  accountId: string;
  initial: AdminReport;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const state = useReportAction(accountId, initial);
  const { form, snapshot, mutation } = state;
  const [action, message, privateNote] = useWatch({
    control: form.control,
    name: ['action', 'message', 'privateNote'],
  });
  const busy = mutation.isPending || state.reading;
  const allowed = Boolean(reportNextStatus(snapshot.status, action));
  const self = snapshot.reporter.id === accountId || snapshot.snapshot.author.id === accountId;
  const submitRef = useRef<HTMLButtonElement>(null),
    latestRef = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useUnsavedDraft(
    state.dirty || busy,
    '举报处理说明尚未保存，确定离开吗',
    (target, current) =>
      target.origin === current.origin &&
      target.pathname === current.pathname &&
      target.searchParams.get('report') === current.searchParams.get('report'),
  );
  useEffect(() => {
    onDirty(state.dirty);
    return () => onDirty(false);
  }, [state.dirty, onDirty]);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="举报处理表单">
      <h2 className="text-lg font-semibold">核对并处理</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        核对线索后记录决定，完成处理时可一并下架内容或封禁账号
      </p>
      <Collapsible>
        <CollapsibleTrigger render={<Button variant="ghost" className="min-h-11" />}>
          关联管理入口
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <div className="flex flex-wrap gap-2">
            <Link
              className={buttonVariants({ variant: 'outline' })}
              href={
                snapshot.snapshot.type === 'profile'
                  ? '/admin/profiles?status=all&submission=' +
                    snapshot.snapshot.profile.submissionId
                  : '/admin/personas?personaId=' + snapshot.personaId
              }
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
            >
              {snapshot.snapshot.type === 'profile' ? '管理公开资料' : '管理关联人设'}
            </Link>
            {snapshot.snapshot.type === 'comment' && (
              <Link
                className={buttonVariants({ variant: 'outline' })}
                href={'/admin/comments?status=all&commentId=' + snapshot.snapshot.comment.id}
                target="_blank"
                rel="noopener noreferrer"
                prefetch={false}
              >
                管理关联评论
              </Link>
            )}
            <Link
              className={buttonVariants({ variant: 'outline' })}
              href={'/admin/users?userId=' + snapshot.snapshot.author.id}
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
            >
              管理被举报账号
            </Link>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <Button
        ref={latestRef}
        variant="outline"
        disabled={busy}
        onClick={() => void state.readLatest()}
      >
        {state.reading ? '正在读取…' : '核对最新举报'}
      </Button>
      <FormNotice error={state.readError} message={state.message} />
      {state.candidate && (
        <div className="flex min-w-0 flex-col gap-3 rounded-xl border p-4">
          <p className="text-sm">
            最新状态：{reportStatuses[state.candidate.status]} · 修订 {state.candidate.revision}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            采用最新修订会保留当前说明和内部备注，再由你重新核对处理动作
          </p>
          <Button variant="outline" disabled={busy} onClick={state.adopt}>
            采用最新修订并保留输入
          </Button>
        </div>
      )}
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit((input) => {
            trigger.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : submitRef.current;
            mutation.reset();
            state.setConfirmation(input);
          })(event);
        }}
      >
        <FieldGroup>
          <Controller
            name="action"
            control={form.control}
            render={({ field }) => (
              <Field data-invalid={!allowed}>
                <FieldLabel id="report-action-label">处理动作</FieldLabel>
                <ToggleGroup
                  aria-labelledby="report-action-label"
                  value={[field.value]}
                  onValueChange={(values) => {
                    if (values[0]) field.onChange(values[0]);
                  }}
                  disabled={busy}
                  className="grid w-full grid-cols-2 gap-2"
                  variant="outline"
                >
                  {Object.entries(reportActions).map(([value, label]) => (
                    <ToggleGroupItem
                      key={value}
                      value={value}
                      className="h-auto min-h-11 min-w-11 whitespace-normal py-2"
                      disabled={
                        !reportNextStatus(snapshot.status, value as AdminReportAction['action'])
                      }
                    >
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {!allowed && <FieldError>当前动作不适用于最新状态，请重新选择</FieldError>}
              </Field>
            )}
          />
          <Field data-invalid={Boolean(form.formState.errors.message)}>
            <FieldLabel htmlFor="report-public-message">举报人可见说明</FieldLabel>
            <Textarea
              id="report-public-message"
              className="max-h-[40dvh]"
              rows={4}
              autoComplete="off"
              aria-invalid={Boolean(form.formState.errors.message)}
              disabled={busy}
              {...form.register('message')}
            />
            <FieldDescription>
              受理、完成或驳回时必填，请避免写入内部核验信息 · {Array.from(message ?? '').length} /
              2000 字
            </FieldDescription>
            <FieldError errors={[form.formState.errors.message]} />
          </Field>
          <Field data-invalid={Boolean(form.formState.errors.privateNote)}>
            <FieldLabel htmlFor="report-private-note">仅管理员可见备注</FieldLabel>
            <Textarea
              id="report-private-note"
              className="max-h-[40dvh]"
              rows={4}
              autoComplete="off"
              aria-invalid={Boolean(form.formState.errors.privateNote)}
              disabled={busy}
              {...form.register('privateNote')}
            />
            <FieldDescription>
              内部备注不会出现在举报人的处理记录中 · {Array.from(privateNote ?? '').length} / 5000
              字
            </FieldDescription>
            <FieldError errors={[form.formState.errors.privateNote]} />
          </Field>
          {action === 'resolve' && (
            <ReportResolutionFields form={form} snapshot={snapshot} busy={busy} />
          )}
          {self && (
            <Controller
              name="selfReviewConfirmed"
              control={form.control}
              render={({ field }) => (
                <Field orientation="horizontal">
                  <Checkbox
                    id="report-self-review"
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                    disabled={busy}
                  />
                  <FieldLabel htmlFor="report-self-review" className="min-h-11">
                    我确认此举报涉及本人，并在保存时接受近期身份验证
                  </FieldLabel>
                </Field>
              )}
            />
          )}
          <FormNotice error={mutation.error} />
          <Button
            ref={submitRef}
            type="submit"
            disabled={busy || !allowed || Boolean(state.candidate)}
          >
            核对处理操作
          </Button>
        </FieldGroup>
      </form>
      <AlertDialog
        open={Boolean(state.confirmation)}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) state.setConfirmation(undefined);
        }}
      >
        <AlertDialogContent
          finalFocus={() =>
            trigger.current?.isConnected && !trigger.current.matches(':disabled')
              ? trigger.current
              : latestRef.current
          }
          className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              确认{state.confirmation ? reportActions[state.confirmation.action] : '举报处理'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              核对说明的可见范围，确认后记录到举报历史
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div
            role="region"
            tabIndex={0}
            aria-label="举报处理预览"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
          >
            <p className="font-medium">{snapshot.personaTitle}</p>
            <p className="text-sm">
              {reportStatuses[snapshot.status]} · 修订 {snapshot.revision}
            </p>
            <div>
              <h3 className="font-medium">举报人可见说明</h3>
              <p className="whitespace-pre-wrap text-base leading-7">
                {state.confirmation?.message || '无公开说明，仅保存内部备注'}
              </p>
            </div>
            {state.confirmation?.privateNote && (
              <div>
                <h3 className="font-medium">仅管理员可见备注</h3>
                <p className="whitespace-pre-wrap text-base leading-7">
                  {state.confirmation.privateNote}
                </p>
              </div>
            )}
            {state.confirmation?.resolution && (
              <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <h3 className="font-medium">将同步执行处置</h3>
                {state.confirmation.resolution.content && (
                  <p>
                    {reportContentActions[state.confirmation.resolution.content.action]}
                    {snapshot.version ? ' · v' + snapshot.version : ''}
                  </p>
                )}
                {state.confirmation.resolution.account && (
                  <p>
                    {state.confirmation.resolution.account.scope === 'account_and_personas'
                      ? '封禁被举报账号及其全部作品'
                      : '封禁被举报账号'}
                    ：{snapshot.snapshot.author.username}，并撤销全部登录会话
                  </p>
                )}
                <h3 className="font-medium">被处置者可见说明</h3>
                <p className="whitespace-pre-wrap text-base leading-7">
                  {state.confirmation.resolution.reason}
                </p>
                <p className="text-sm text-muted-foreground">
                  确认后立即限制访问；如需验证身份，当前输入会保留，验证后由你再次提交
                </p>
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>返回修改</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={() => {
                if (state.confirmation) mutation.mutate(state.confirmation);
              }}
            >
              {mutation.isPending && (
                <Spinner data-icon="inline-start" className="motion-reduce:animate-none" />
              )}
              {mutation.isPending ? '正在保存…' : '确认保存处理记录'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
