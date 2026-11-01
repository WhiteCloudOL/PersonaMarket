'use client';
import { useEffect, useRef, useState } from 'react';
import { FormProvider } from 'react-hook-form';
import type { ManagedGuide } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Spinner } from '@personamarket/ui/components/spinner';
import { Badge } from '@personamarket/ui/components/badge';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '@personamarket/ui/components/field';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { FormNotice } from '../auth/auth-fields';
import { useGuideEditor } from './use-guide-editor';
import { GuideEditorFields } from './editor-fields';
import { GuideConfirmation } from './editor-confirmation';
import { GuideBody } from './guide-body';
import { guideStatuses } from './guide-labels';

export function GuideEditorForm({
  accountId,
  initial,
  onDirty,
  onBusy,
}: {
  accountId: string;
  initial: ManagedGuide;
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
}) {
  const editor = useGuideEditor(accountId, initial);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  const latestButton = useRef<HTMLButtonElement | null>(null);
  const {
    form,
    snapshot,
    candidate,
    confirm,
    setConfirm,
    reading,
    readError,
    message,
    values,
    changed,
    dirty,
    mutation,
    busy,
    readLatest,
    adoptLatest,
    prepareAction,
    submitAction,
    save,
  } = editor;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(save, (errors) => {
          setTab('edit');
          const field = (['title', 'summary', 'bodyMarkdown', 'reason'] as const).find((key) =>
            Boolean(errors[key]),
          );
          if (field) requestAnimationFrame(() => form.setFocus(field));
        })}
        className="min-w-0"
      >
        <FieldGroup className="min-w-0 gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{guideStatuses[snapshot.status]}</Badge>
            <span className="text-sm text-muted-foreground">核对修订 {snapshot.revision}</span>
            {snapshot.hasUnpublishedChanges && <Badge variant="outline">编辑稿有更新</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {snapshot.status === 'published'
              ? '修改编辑稿后需要再次确认发布，读者继续看到上次公开内容'
              : '保存后核对正文，再确认发布此章节'}
          </p>
          <fieldset disabled={busy} className="min-w-0">
            <GuideEditorFields values={values} tab={tab} setTab={setTab} />
          </fieldset>
          <Field data-invalid={Boolean(form.formState.errors.reason)}>
            <FieldLabel htmlFor="guide-reason">处理理由</FieldLabel>
            <Textarea
              id="guide-reason"
              autoComplete="off"
              rows={3}
              disabled={busy}
              aria-invalid={Boolean(form.formState.errors.reason)}
              aria-describedby="guide-reason-help guide-reason-error"
              {...form.register('reason')}
            />
            <FieldDescription id="guide-reason-help">
              说明此次修改、发布或撤回的原因，仅管理员可见
            </FieldDescription>
            <FieldError id="guide-reason-error" errors={[form.formState.errors.reason]} />
          </Field>
          <FormNotice error={mutation.error ?? readError} message={message} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !changed}>
              {mutation.isPending && <Spinner aria-hidden className="motion-reduce:animate-none" />}
              {mutation.isPending ? '正在处理…' : '保存编辑稿'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              ref={latestButton}
              onClick={() => void readLatest()}
            >
              {reading ? '正在读取…' : '核对最新指南'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={
                busy ||
                changed ||
                (snapshot.status === 'published' && !snapshot.hasUnpublishedChanges)
              }
              onClick={(event) => {
                actionTrigger.current = event.currentTarget;
                void prepareAction('publish');
              }}
            >
              发布指南
            </Button>
            {snapshot.status === 'published' && (
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={(event) => {
                  actionTrigger.current = event.currentTarget;
                  void prepareAction('withdraw');
                }}
              >
                撤回指南
              </Button>
            )}
          </div>
          {changed && (
            <p className="text-sm text-muted-foreground">
              先保存待修改的编辑稿，再核对发布；撤回公开内容会保留当前输入
            </p>
          )}
          {candidate && (
            <Alert role="status">
              <AlertTitle>服务器最新指南</AlertTitle>
              <AlertDescription className="flex min-w-0 flex-col items-start gap-3">
                <p className="[overflow-wrap:anywhere]">
                  {candidate.title} · {guideStatuses[candidate.status]} · 修订 {candidate.revision}
                </p>
                <p className="[overflow-wrap:anywhere]">{candidate.summary}</p>
                <div
                  role="region"
                  aria-label="最新指南正文"
                  tabIndex={0}
                  className="max-h-[40dvh] w-full min-w-0 overflow-y-auto overscroll-contain rounded-lg border p-3 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <GuideBody text={candidate.bodyMarkdown} />
                </div>
                <p>采用最新修订会保留当前输入，请对照正文后继续保存</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  className="h-auto min-h-11 max-w-full py-2 whitespace-normal"
                  onClick={adoptLatest}
                >
                  采用最新修订继续核对
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </FieldGroup>
      </form>
      <GuideConfirmation
        action={confirm}
        snapshot={snapshot}
        reason={values.reason}
        busy={mutation.isPending}
        error={mutation.error}
        close={() => setConfirm(undefined)}
        submit={submitAction}
        restoreFocus={() => {
          // 发布会禁用原按钮，撤回会移除原按钮，成功后转到仍可用的核对入口
          const trigger = actionTrigger.current;
          return trigger?.isConnected &&
            !trigger.disabled &&
            trigger.getAttribute('aria-disabled') !== 'true'
            ? trigger
            : latestButton.current;
        }}
      />
    </FormProvider>
  );
}
