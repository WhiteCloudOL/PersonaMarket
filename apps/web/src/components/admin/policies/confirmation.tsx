'use client';
import { useId } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ReviewPolicySchema,
  SubmitPolicySchema,
  WithdrawPolicySchema,
  UnpublishPolicySchema,
  ActivatePolicySchema,
  type ManagedPolicy,
} from '@personamarket/contracts';
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
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Spinner } from '@personamarket/ui/components/spinner';
import { GuideBody } from '@/components/guides/guide-body';
import { FormNotice } from '@/components/auth/auth-fields';
import { intentLabel, type PolicyIntent, type PolicyActionValues } from './labels';
import type { PolicyCommand } from './api';

const ActionFieldsSchema = z.strictObject({
  reason: ReviewPolicySchema.shape.reason.removeDefault(),
  selfReviewConfirmed: z.boolean(),
});
function parsedCommand(intent: PolicyIntent, values: PolicyActionValues): PolicyCommand {
  const input = { reason: values.reason, confirmed: true };
  if (intent.kind === 'submit') return { kind: 'submit', input: SubmitPolicySchema.parse(input) };
  if (intent.kind === 'unpublish')
    return { kind: 'unpublish', input: UnpublishPolicySchema.parse(input) };
  if (intent.kind === 'withdraw')
    return { kind: 'withdraw', id: intent.submission.id, input: WithdrawPolicySchema.parse(input) };
  if (intent.kind === 'activate')
    return {
      kind: 'activate',
      input: ActivatePolicySchema.parse({ ...input, publicationId: intent.submission.id }),
    };
  return {
    kind: 'review',
    id: intent.submission.id,
    input: ReviewPolicySchema.parse({
      ...input,
      decision: intent.decision,
      selfReviewConfirmed: values.selfReviewConfirmed,
    }),
  };
}
export function PolicyConfirmation({
  intent,
  snapshot,
  initialValues,
  busy,
  unresolved,
  error,
  close,
  onChange,
  submit,
  restoreFocus,
}: {
  intent: PolicyIntent;
  snapshot: ManagedPolicy;
  initialValues: PolicyActionValues;
  busy: boolean;
  unresolved: boolean;
  error: Error | null;
  close: () => void;
  onChange: (value: PolicyActionValues) => void;
  submit: (command: PolicyCommand, revision: number) => void;
  restoreFocus: () => HTMLElement | null;
}) {
  const id = useId();
  const form = useForm<PolicyActionValues>({
    resolver: zodResolver(ActionFieldsSchema),
    defaultValues: initialValues,
  });
  const selfReview = intent.kind === 'review' && intent.submission.selfReviewRequired;
  const publication =
    'submission' in intent
      ? intent.submission.snapshot
      : intent.kind === 'unpublish'
        ? snapshot.published
        : snapshot;
  const dangerous =
    intent.kind === 'unpublish' ||
    intent.kind === 'withdraw' ||
    (intent.kind === 'review' && intent.decision === 'reject');
  return (
    <AlertDialog
      open
      onOpenChange={(open, details) => {
        if (!open && busy) details.cancel();
        else if (!open) close();
      }}
    >
      <AlertDialogContent
        finalFocus={restoreFocus}
        className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col"
      >
        <AlertDialogHeader className="shrink-0">
          <AlertDialogTitle>{intentLabel(intent)}</AlertDialogTitle>
          <AlertDialogDescription>
            {intent.kind === 'submit'
              ? '把已保存草稿冻结为待审快照，审核通过后才替换公开版'
              : intent.kind === 'unpublish'
                ? '下线后公开页面停止展示当前版本，私有草稿与批准历史保留'
                : intent.kind === 'withdraw'
                  ? '撤回这份待审快照，现有公开版继续展示'
                  : intent.kind === 'activate'
                    ? '以一次新激活操作切换公开版，草稿与批准快照保持原内容'
                    : intent.decision === 'approve'
                      ? '核对这份冻结快照，通过后立即成为当前公开版'
                      : '驳回这份冻结快照，现有公开版继续展示'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain rounded-lg [overflow-wrap:anywhere]">
          <div
            role="region"
            aria-label="规则操作正文核对"
            tabIndex={0}
            className="flex flex-col gap-3 rounded-lg border p-3 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <h3 className="font-semibold">{publication?.title}</h3>
            {publication?.summary && (
              <p className="text-sm text-muted-foreground">{publication.summary}</p>
            )}
            {publication && <GuideBody text={publication.bodyMarkdown} />}
          </div>
          <form
            id={id}
            noValidate
            onSubmit={form.handleSubmit((values) => {
              try {
                if (selfReview && !values.selfReviewConfirmed) {
                  form.setError('selfReviewConfirmed', {
                    message: '请明确确认以管理员身份自审这份快照',
                  });
                  form.setFocus('selfReviewConfirmed');
                  return;
                }
                submit(parsedCommand(intent, values), intent.revision);
              } catch (cause) {
                if (cause instanceof z.ZodError) {
                  form.setError('reason', {
                    message: cause.issues[0]?.message ?? '请核对处理理由',
                  });
                  form.setFocus('reason');
                } else throw cause;
              }
            })}
          >
            <FieldGroup>
              <Field data-invalid={Boolean(form.formState.errors.reason)}>
                <FieldLabel htmlFor={id + '-reason'}>处理理由</FieldLabel>
                <Textarea
                  id={id + '-reason'}
                  rows={3}
                  autoComplete="off"
                  disabled={busy}
                  aria-invalid={Boolean(form.formState.errors.reason)}
                  aria-describedby={id + '-reason-help ' + id + '-reason-error'}
                  {...form.register('reason', { onChange: () => onChange(form.getValues()) })}
                />
                <FieldDescription id={id + '-reason-help'}>
                  {intent.kind === 'review' && intent.decision === 'approve' && !selfReview
                    ? '审核他人时理由可留空'
                    : '请说明本次操作依据，最多 2,000 字，仅管理员可见'}
                </FieldDescription>
                <FieldError id={id + '-reason-error'} errors={[form.formState.errors.reason]} />
              </Field>
              {selfReview && (
                <Controller
                  control={form.control}
                  name="selfReviewConfirmed"
                  render={({ field }) => (
                    <Field data-invalid={Boolean(form.formState.errors.selfReviewConfirmed)}>
                      <FieldLabel
                        htmlFor={id + '-self'}
                        className="flex min-h-11 items-center gap-3 rounded-lg border p-3"
                      >
                        <Checkbox
                          id={id + '-self'}
                          ref={field.ref}
                          checked={field.value}
                          disabled={busy}
                          aria-invalid={Boolean(form.formState.errors.selfReviewConfirmed)}
                          onCheckedChange={(checked) => {
                            field.onChange(checked);
                            onChange({ ...form.getValues(), selfReviewConfirmed: checked });
                          }}
                        />
                        <span className="min-w-0">我确认以管理员身份自审这份快照</span>
                      </FieldLabel>
                      <FieldDescription>
                        你参与过本轮编辑或送审，自审还需要近期身份验证与明确理由
                      </FieldDescription>
                      <FieldError errors={[form.formState.errors.selfReviewConfirmed]} />
                    </Field>
                  )}
                />
              )}
            </FieldGroup>
          </form>
          <FormNotice error={error} />
          {unresolved && (
            <p role="status" className="text-sm text-muted-foreground">
              请求结果尚未确认，请返回页面核对原提交结果，原请求与当前输入都已保留
            </p>
          )}
          {busy && <p role="status">正在处理，请等待结果</p>}
        </div>
        <AlertDialogFooter className="shrink-0">
          <AlertDialogCancel disabled={busy}>返回核对</AlertDialogCancel>
          <AlertDialogAction
            form={id}
            type="submit"
            disabled={busy || unresolved}
            variant={dangerous ? 'destructive' : 'default'}
            className="h-auto min-h-11 whitespace-normal py-2"
          >
            {busy && (
              <Spinner
                data-icon="inline-start"
                aria-hidden
                className="motion-reduce:animate-none"
              />
            )}
            {busy ? '正在处理…' : '确认操作'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
