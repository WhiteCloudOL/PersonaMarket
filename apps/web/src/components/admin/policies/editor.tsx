'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { FormProvider } from 'react-hook-form';
import { RefreshCwIcon } from 'lucide-react';
import { PolicyFieldsSchema, type ManagedPolicy } from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Spinner } from '@personamarket/ui/components/spinner';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '@personamarket/ui/components/field';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { FormNotice } from '@/components/auth/auth-fields';
import { EditorSection } from '@/components/personas/editor-section';
import { GuideBody } from '@/components/guides/guide-body';
import { announcementDate } from '@/components/announcements/announcement-content';
import { PolicyEditorFields } from './editor-fields';
import { PolicyConfirmation } from './confirmation';
import { PolicyHistory, PolicySubmissionDetails } from './history';
import { usePolicyEditor } from './use-policy-editor';
import { intentKey, policyLabels, type PolicyIntent } from './labels';

const buttonClass = 'h-auto min-h-11 max-w-full whitespace-normal py-2';
export function PolicyEditor({
  accountId,
  initial,
}: {
  accountId: string;
  initial: ManagedPolicy;
}) {
  const editor = usePolicyEditor(accountId, initial);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [pendingOpen, setPendingOpen] = useState(false);
  const [publicOpen, setPublicOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const {
    form,
    snapshot,
    candidate,
    values,
    changed,
    dirty,
    busy,
    reading,
    message,
    readError,
    mutation,
    intent,
    setIntent,
    unresolved,
    originalRequest,
    actionValues,
    stableButton,
    readLatest,
    adoptLatest,
    prepareIntent,
    submit,
    replayOriginal,
  } = editor;
  const pending =
    snapshot.latestSubmission?.status === 'pending' ? snapshot.latestSubmission : null;
  const complete = PolicyFieldsSchema.safeParse({
    title: snapshot.title,
    summary: snapshot.summary,
    bodyMarkdown: snapshot.bodyMarkdown,
  }).success;
  function prepare(next: PolicyIntent, source?: HTMLElement) {
    trigger.current = source ?? stableButton.current;
    prepareIntent(next);
  }
  return (
    <div className="flex min-w-0 flex-col gap-5" data-policy-document={snapshot.slug}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant={snapshot.published ? 'secondary' : 'outline'}>
          {snapshot.published ? '已有公开版' : '尚未公开'}
        </Badge>
        <span className="text-sm text-muted-foreground">当前核对修订 {snapshot.revision}</span>
        <Button
          ref={stableButton}
          type="button"
          variant="outline"
          size="icon"
          className="size-11 shrink-0"
          aria-label="核对最新规则"
          title="核对最新规则"
          aria-disabled={busy}
          onClick={() => {
            if (!busy) void readLatest();
          }}
        >
          {reading ? (
            <Spinner aria-hidden className="motion-reduce:animate-none" />
          ) : (
            <RefreshCwIcon aria-hidden />
          )}
        </Button>
        {pending && (
          <Button
            type="button"
            variant="outline"
            disabled={busy || unresolved}
            className={buttonClass}
            onClick={() => setPendingOpen(true)}
          >
            查看待审快照
          </Button>
        )}
      </div>
      <FormNotice message={message} />
      <FormProvider {...form}>
        <form
          noValidate
          onSubmit={form.handleSubmit(
            (input) => submit({ kind: 'write', input }, snapshot.revision),
            (errors) => {
              setTab('edit');
              const name = (['title', 'summary', 'bodyMarkdown', 'reason'] as const).find((key) =>
                Boolean(errors[key]),
              );
              if (name) requestAnimationFrame(() => form.setFocus(name));
            },
          )}
          className="flex min-w-0 flex-col gap-5"
        >
          <EditorSection
            title="当前草稿"
            description={
              snapshot.hasUnpublishedChanges
                ? '草稿有未公开变化，审批只读取冻结的送审快照'
                : '编辑与送审分别保存，审核通过才更新公开版'
            }
          >
            <fieldset
              disabled={mutation.isPending}
              aria-label="公共规则草稿表单"
              className="min-w-0 border-0 p-0"
            >
              <FieldGroup>
                <PolicyEditorFields values={values} tab={tab} setTab={setTab} />
                <Field data-invalid={Boolean(form.formState.errors.reason)}>
                  <FieldLabel htmlFor="policy-edit-reason">草稿修改理由</FieldLabel>
                  <Textarea
                    id="policy-edit-reason"
                    rows={3}
                    autoComplete="off"
                    aria-invalid={Boolean(form.formState.errors.reason)}
                    aria-describedby="policy-edit-reason-help policy-edit-reason-error"
                    {...form.register('reason')}
                  />
                  <FieldDescription id="policy-edit-reason-help">
                    说明本次草稿修改的依据，最多 2,000 字，仅管理员可见
                  </FieldDescription>
                  <FieldError
                    id="policy-edit-reason-error"
                    errors={[form.formState.errors.reason]}
                  />
                </Field>
                <div
                  className="flex flex-wrap items-center gap-3"
                  role="group"
                  aria-label="规则草稿保存操作"
                >
                  <Button
                    type="submit"
                    disabled={busy || unresolved || !changed}
                    className={buttonClass}
                  >
                    {mutation.isPending && (
                      <Spinner
                        data-icon="inline-start"
                        aria-hidden
                        className="motion-reduce:animate-none"
                      />
                    )}
                    {mutation.isPending ? '正在处理…' : '保存规则草稿'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || unresolved || changed || !complete || Boolean(pending)}
                    className={buttonClass}
                    onClick={(event) =>
                      prepare({ kind: 'submit', revision: snapshot.revision }, event.currentTarget)
                    }
                  >
                    提交规则审核
                  </Button>
                  {dirty && (
                    <p role="status" className="basis-full text-sm text-muted-foreground">
                      有未保存输入或待核对操作，在当前账号的页面间暂存，刷新页面后不保留
                    </p>
                  )}
                  {changed && (
                    <p className="basis-full text-sm text-muted-foreground">
                      先保存草稿，再核对送审；已有待审快照与公开版仍保留原内容
                    </p>
                  )}
                </div>
              </FieldGroup>
            </fieldset>
          </EditorSection>
        </form>
      </FormProvider>
      <Collapsible>
        <CollapsibleTrigger
          render={<Button type="button" variant="outline" className={buttonClass} />}
        >
          查看核对依据与公开入口
        </CollapsibleTrigger>
        <CollapsibleContent className="flex min-w-0 flex-col items-start gap-3 pt-4 text-sm text-muted-foreground">
          <p className="[overflow-wrap:anywhere]">
            {snapshot.updatedBy ? '最近修改：' + snapshot.updatedBy : '暂无修改记录'}
            {snapshot.updatedAt ? ' · ' + announcementDate(snapshot.updatedAt) : ''}
          </p>
          {pending && (
            <p className="[overflow-wrap:anywhere]">
              待审来源修订 {pending.sourceRevision} · 送审人 {pending.submittedBy.username}
              ，送审后的编辑不改变这份快照
            </p>
          )}
          {snapshot.published && (
            <Link
              href={'/' + snapshot.slug + '?publicationId=' + snapshot.published.publicationId}
              className={buttonVariants({ variant: 'outline', className: buttonClass })}
            >
              查看当前公开版
            </Link>
          )}
        </CollapsibleContent>
      </Collapsible>
      <FormNotice error={intent ? readError : (mutation.error ?? readError)} />
      {unresolved && originalRequest && (
        <Alert role="status">
          <AlertTitle>原提交结果待核对</AlertTitle>
          <AlertDescription className="flex min-w-0 flex-col items-start gap-3">
            <p>
              {policyLabels[snapshot.slug]} ·{' '}
              {originalRequest.command.kind === 'write'
                ? '保存草稿'
                : originalRequest.command.kind === 'review'
                  ? originalRequest.command.input.decision === 'approve'
                    ? '批准快照'
                    : '驳回快照'
                  : originalRequest.command.kind === 'submit'
                    ? '提交审核'
                    : originalRequest.command.kind === 'withdraw'
                      ? '撤回送审'
                      : originalRequest.command.kind === 'activate'
                        ? '激活批准版'
                        : '下线公开版'}{' '}
              · 原核对修订 {originalRequest.revision}
            </p>
            {originalRequest.targetTitle && (
              <p className="[overflow-wrap:anywhere]">
                原快照：{originalRequest.targetTitle} · 来源修订 {originalRequest.sourceRevision}
              </p>
            )}
            <p>核对使用暂存的原请求和幂等标识，当前输入不会替代原请求</p>
            <Collapsible>
              <CollapsibleTrigger
                render={<Button type="button" variant="outline" className={buttonClass} />}
              >
                查看原提交依据
              </CollapsibleTrigger>
              <CollapsibleContent className="flex min-w-0 flex-col gap-3 pt-3">
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  处理理由：{originalRequest.command.input.reason || '未填写补充理由'}
                </p>
                {originalRequest.command.kind === 'write' && (
                  <>
                    <p className="[overflow-wrap:anywhere]">
                      原草稿标题：{originalRequest.command.input.title || '空白标题'}
                    </p>
                    <div
                      role="region"
                      aria-label="原提交草稿正文"
                      tabIndex={0}
                      className="max-h-64 min-w-0 overflow-y-auto rounded-lg border p-3 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <GuideBody text={originalRequest.command.input.bodyMarkdown} />
                    </div>
                  </>
                )}
                {'id' in originalRequest.command && (
                  <p className="break-all text-sm">送审快照：{originalRequest.command.id}</p>
                )}
                {originalRequest.command.kind === 'activate' && (
                  <p className="break-all text-sm">
                    批准版本：{originalRequest.command.input.publicationId}
                  </p>
                )}
              </CollapsibleContent>
            </Collapsible>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className={buttonClass}
              onClick={replayOriginal}
            >
              核对原提交结果
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {candidate && (
        <Alert role="status">
          <AlertTitle>服务器最新规则 · 修订 {candidate.revision}</AlertTitle>
          <AlertDescription className="flex min-w-0 flex-col items-start gap-3">
            <p className="[overflow-wrap:anywhere]">
              {candidate.title || '空白草稿'} · {candidate.published ? '已有公开版' : '尚未公开'} ·{' '}
              {candidate.latestSubmission?.status === 'pending' ? '有待审快照' : '暂无待审快照'}
            </p>
            <Collapsible className="w-full min-w-0">
              <CollapsibleTrigger
                render={<Button type="button" variant="outline" className={buttonClass} />}
              >
                查看最新草稿正文
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <div
                  role="region"
                  aria-label="最新草稿正文"
                  tabIndex={0}
                  className="max-h-72 min-w-0 overflow-y-auto rounded-lg border p-3 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <GuideBody text={candidate.bodyMarkdown} />
                </div>
              </CollapsibleContent>
            </Collapsible>
            <p>采用最新修订会保留当前输入与处理理由，请再次核对后手动确认操作</p>
            <Button
              type="button"
              variant="outline"
              disabled={busy || unresolved}
              className={buttonClass}
              onClick={adoptLatest}
            >
              采用最新修订继续核对
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <Collapsible open={publicOpen} onOpenChange={setPublicOpen}>
        <CollapsibleTrigger
          render={<Button type="button" variant="outline" className={buttonClass} />}
        >
          {publicOpen ? '收起公开版管理' : '管理当前公开版'}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          {snapshot.published ? (
            <section
              aria-label="当前公开规则管理"
              className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4"
            >
              <h3 className="font-semibold [overflow-wrap:anywhere]">{snapshot.published.title}</h3>
              <p className="text-sm text-muted-foreground">
                批准于 {announcementDate(snapshot.published.publishedAt)} · 当前激活于{' '}
                {announcementDate(snapshot.published.activatedAt)}
              </p>
              <p className="text-sm text-muted-foreground">
                下线后公开入口停止展示，历史批准版本可从记录中重新激活
              </p>
              <Button
                type="button"
                variant="destructive"
                className={buttonClass}
                disabled={busy || unresolved}
                onClick={(event) =>
                  prepare({ kind: 'unpublish', revision: snapshot.revision }, event.currentTarget)
                }
              >
                下线当前公开版
              </Button>
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">
              此规则尚无当前公开版，可在审核通过后公开，或从历史中激活已有批准版
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
      <PolicyHistory
        accountId={accountId}
        snapshot={snapshot}
        busy={busy || unresolved}
        onIntent={(value) => prepare(value)}
      />
      {pendingOpen && pending && (
        <PolicySubmissionDetails
          accountId={accountId}
          slug={snapshot.slug}
          id={pending.id}
          publishedId={snapshot.published?.publicationId ?? null}
          busy={busy || unresolved}
          close={() => setPendingOpen(false)}
          onIntent={(value) => prepare(value)}
        />
      )}
      {intent && (
        <PolicyConfirmation
          key={intentKey(intent)}
          intent={intent}
          snapshot={snapshot}
          initialValues={
            actionValues[intentKey(intent)] ?? { reason: '', selfReviewConfirmed: false }
          }
          busy={mutation.isPending}
          unresolved={unresolved}
          error={mutation.error}
          close={() => setIntent(undefined)}
          onChange={editor.updateActionValues}
          submit={submit}
          restoreFocus={() => {
            const element = trigger.current;
            return element?.isConnected &&
              !element.hasAttribute('disabled') &&
              element.getAttribute('aria-disabled') !== 'true'
              ? element
              : stableButton.current;
          }}
        />
      )}
    </div>
  );
}
