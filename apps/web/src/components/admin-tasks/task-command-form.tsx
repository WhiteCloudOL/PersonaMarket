'use client';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { RetryAdminTaskSchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
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
import { needsOperationVerification } from '../auth/step-up-prompt';
import { notificationTimestamp } from '../notifications/delivery-state';
import {
  canStartTaskCommand,
  type ExactTaskCommand,
  type ExactTaskTarget,
} from './task-command-state';
import type { useTaskCommand } from './use-task-command';

const ReasonSchema = z.strictObject({ reason: RetryAdminTaskSchema.shape.reason });
export function TaskCommandForm({
  flow,
  target,
  version,
  eligible,
  settled,
  latest,
}: {
  flow: ReturnType<typeof useTaskCommand>;
  target: ExactTaskTarget;
  version: string | undefined;
  eligible: boolean;
  settled: number;
  latest: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId(),
    opener = useRef<HTMLButtonElement>(null),
    submitted = useRef(false),
    priorSettled = useRef(settled);
  const [open, setOpen] = useState(false),
    [basis, setBasis] = useState<ExactTaskCommand['input']>();
  const form = useForm<z.input<typeof ReasonSchema>, undefined, z.output<typeof ReasonSchema>>({
    resolver: zodResolver(ReasonSchema),
    defaultValues: { reason: flow.draft?.reason ?? '' },
  });
  const command = flow.draft?.command,
    mail = target.kind === 'mail',
    canStart = Boolean(version && canStartTaskCommand(version, flow.draft)),
    showForm = eligible || command?.outcome === 'rejected';
  useEffect(() => {
    if (priorSettled.current === settled) return;
    priorSettled.current = settled;
    setOpen(false);
  }, [settled]);
  const reasonField = form.register('reason');
  function confirm(values: z.output<typeof ReasonSchema>) {
    if (!version || !eligible || !canStart || flow.busy) return;
    flow.write.reset();
    submitted.current = false;
    setBasis({
      expectedVersion: version,
      reason: values.reason,
      confirmed: true,
      ...(target.kind === 'ranking'
        ? {}
        : { action: mail ? ('acknowledge' as const) : ('retry' as const) }),
    });
    setOpen(true);
  }
  return (
    <>
      {command && (
        <section aria-label="原处理请求" className="flex min-w-0 flex-col gap-3">
          <Alert aria-live="polite">
            <AlertTitle>
              {command.outcome === 'accepted' ? '原请求已受理' : '原请求已保留'}
            </AlertTitle>
            <AlertDescription>
              {flow.draft?.message ?? '原对象、载荷与标识已保留；不会自动提交'}
            </AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            原对象：{target.kind === 'ranking' ? '榜单批次' : mail ? '邮件事件' : '清理事件'}{' '}
            {command.target.id}；依据版本 {command.input.expectedVersion.slice(0, 12)}…
          </p>
          {flow.draft?.receipt && (
            <p role="status" className="text-sm text-muted-foreground">
              {flow.draft.receipt.recorded ? (
                <>
                  受理回执时间：
                  {flow.draft.receipt.recordedAt
                    ? notificationTimestamp(flow.draft.receipt.recordedAt)
                    : '未记录'}
                </>
              ) : (
                '本次未找到原请求记录，这不排除迟到请求'
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={flow.busy}
              onClick={flow.checkOriginal}
            >
              {flow.receipt.isPending ? '正在核对原请求…' : '核对原请求'}
            </Button>
            {command.outcome !== 'accepted' && (
              <Button type="button" variant="outline" disabled={flow.busy} onClick={flow.repeat}>
                明确重试原请求
              </Button>
            )}
          </div>
          <FormNotice error={flow.receipt.error} />
          <Collapsible>
            <CollapsibleTrigger
              render={<Button type="button" variant="ghost" />}
              className="h-auto min-h-11 whitespace-normal"
            >
              查看原请求内容与标识
            </CollapsibleTrigger>
            <CollapsibleContent>
              <dl className="grid min-w-0 gap-3 py-3 text-sm">
                <Fact label="原处理原因" value={command.input.reason} />
                <Fact label="原操作标识" value={command.key} />
                <Fact label="原载荷指纹" value={command.hash} />
              </dl>
            </CollapsibleContent>
          </Collapsible>
        </section>
      )}
      {!open && (
        <>
          <FormNotice error={flow.write.error} />
          <FormNotice error={flow.prepareError} />
        </>
      )}
      {showForm && (
        <form noValidate onSubmit={(event) => void form.handleSubmit(confirm)(event)}>
          <FieldGroup>
            <Field
              data-invalid={Boolean(form.formState.errors.reason)}
              data-disabled={flow.busy || !canStart}
            >
              <FieldLabel htmlFor={id + '-reason'}>处理原因</FieldLabel>
              <Textarea
                id={id + '-reason'}
                autoComplete="off"
                rows={3}
                disabled={flow.busy || !canStart}
                aria-invalid={Boolean(form.formState.errors.reason)}
                aria-describedby={id + '-reason-help'}
                {...reasonField}
                onChange={(event) => {
                  void reasonField.onChange(event);
                  flow.setReason(event.target.value);
                }}
              />
              <FieldDescription id={id + '-reason-help'}>
                填写5–500个字符，只记录业务核对结果，不要填写密码、地址或令牌
              </FieldDescription>
              <FieldError>{form.formState.errors.reason?.message}</FieldError>
            </Field>
            {!canStart && (
              <p role="status" className="text-sm text-muted-foreground">
                原请求尚未确认，先核对原请求；不会为未确定的操作创建新标识
              </p>
            )}
            <Button ref={opener} type="submit" disabled={flow.busy || !canStart || !eligible}>
              {mail ? '记录人工核对说明' : '创建受控重试'}
            </Button>
          </FieldGroup>
        </form>
      )}
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (flow.busy) return;
          if (!value && needsOperationVerification(flow.write.error)) flow.write.reset();
          setOpen(value);
        }}
      >
        <AlertDialogContent
          finalFocus={() =>
            submitted.current
              ? latest.current
              : opener.current?.isConnected
                ? opener.current
                : latest.current
          }
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mail ? '确认记录人工核对说明' : '确认创建受控重试'}
            </AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              {mail
                ? '仅追加说明，不重发邮件，不修改SMTP投递结果。'
                : '依据刚读取的版本恢复同一原任务，提交时服务端会再次核对资格。'}{' '}
              原对象 {target.id}。受理不代表业务完成。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormNotice error={flow.write.error} />
          <FormNotice error={flow.prepareError} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={flow.busy}>返回核对</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                flow.busy || !basis || !eligible || !canStart || basis.expectedVersion !== version
              }
              onClick={(event) => {
                event.preventDefault();
                if (basis) {
                  submitted.current = true;
                  void flow.start(basis);
                }
              }}
            >
              {flow.busy ? '正在受理…' : '确认并提交'}
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
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
