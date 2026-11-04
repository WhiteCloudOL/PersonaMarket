'use client';
import { useState, useSyncExternalStore } from 'react';
import { useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  ModelSuggestionsWriteSchema,
  type ModelSuggestionsWrite,
  type ModelSuggestionsResponse,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
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
import { Spinner } from '@personamarket/ui/components/spinner';
import { cn } from '@personamarket/ui/lib/utils';
import { authQuery } from '@/lib/auth-api';
import { modelSuggestionsApi, modelSuggestionsKey } from '@/lib/model-suggestions-api';
import { FormNotice } from '../auth/auth-fields';
import { ModelSuggestionsInputs } from './model-suggestions-inputs';
import { ModelSuggestionsSummary } from './model-suggestions-summary';
import { ModelSuggestionsRecords } from './model-suggestions-records';

import { useSettingsForm } from './use-settings-form';

function subscribeViewport(listener: () => void) {
  window.addEventListener('resize', listener);
  window.visualViewport?.addEventListener('resize', listener);
  return () => {
    window.removeEventListener('resize', listener);
    window.visualViewport?.removeEventListener('resize', listener);
  };
}
// 软键盘等场景下优先让完整输入框可见，保存操作回到文档流
const minimumStickyViewportHeight = 640;
const constrainedViewport = () =>
  (window.visualViewport?.height ?? window.innerHeight) < minimumStickyViewportHeight;
const serverViewport = () => false;
function Fields({ accountId, initial }: { accountId: string; initial: ModelSuggestionsResponse }) {
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const { form, snapshot, busy, dirty, canSave, save, message, error } = useSettingsForm<
    Pick<ModelSuggestionsWrite, 'data'>,
    ModelSuggestionsResponse
  >({
    accountId,
    queryKey: modelSuggestionsKey(accountId),
    initial,
    resolver: zodResolver(ModelSuggestionsWriteSchema.pick({ data: true })),
    valuesFor: (result) => ({ data: result.data }),
    read: (signal) => modelSuggestionsApi.read(accountId, signal),
    write: (input, base, key) =>
      modelSuggestionsApi.write(accountId, input, base.meta.revision, key),
    saved: '模型建议已保存，创作页面重新读取时使用新列表',
  });
  const data = useWatch({ control: form.control, name: 'data' });
  const constrained = useSyncExternalStore(subscribeViewport, constrainedViewport, serverViewport);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={busy}
        onClick={() => setDefaultsOpen(true)}
      >
        预览默认设置
      </Button>
      <form noValidate onSubmit={form.handleSubmit(save)} className="flex min-w-0 flex-col gap-5">
        <fieldset
          disabled={busy}
          aria-label="模型建议表单"
          className="flex min-w-0 flex-col gap-5 border-0 p-0 [&_input]:scroll-mb-36 [&_textarea]:scroll-mb-36"
        >
          <ModelSuggestionsInputs form={form} disabled={busy} />
          <div
            role="group"
            aria-label="模型建议保存操作"
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-panel',
              !constrained && 'sticky bottom-[max(1rem,env(safe-area-inset-bottom))]',
            )}
          >
            {(dirty || busy) && (
              <p role="status" className="basis-full text-sm text-muted-foreground">
                {busy ? '正在保存，请等待结果' : dirty ? '有未保存的模型建议' : ''}
              </p>
            )}
            {(message || error) && (
              <div className="min-w-0 basis-full">
                <FormNotice message={message} error={error} />
              </div>
            )}
            <Button type="submit" disabled={busy || !canSave}>
              {busy && (
                <Spinner
                  data-icon="inline-start"
                  aria-hidden="true"
                  className="motion-reduce:animate-none"
                />
              )}
              {busy ? '正在保存…' : '保存模型建议'}
            </Button>
          </div>
        </fieldset>
      </form>
      <AlertDialog open={defaultsOpen} onOpenChange={setDefaultsOpen}>
        <AlertDialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <AlertDialogHeader className="shrink-0">
            <AlertDialogTitle>预览模型建议默认设置</AlertDialogTitle>
            <AlertDialogDescription>默认值会填入表单，点击保存后生效</AlertDialogDescription>
          </AlertDialogHeader>
          <div
            role="region"
            aria-label="模型建议默认设置对照"
            tabIndex={0}
            className="grid min-h-0 gap-5 overflow-y-auto overscroll-contain rounded-lg focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-2"
          >
            <section className="flex min-w-0 flex-col gap-3">
              <h3 className="font-semibold">当前输入</h3>
              <ModelSuggestionsSummary value={data} />
            </section>
            <section className="flex min-w-0 flex-col gap-3">
              <h3 className="font-semibold">默认设置</h3>
              <ModelSuggestionsSummary value={snapshot.defaults} />
            </section>
          </div>
          <AlertDialogFooter className="shrink-0">
            <AlertDialogCancel>保留当前输入</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                form.reset({
                  data: structuredClone(snapshot.defaults),
                });
                setDefaultsOpen(false);
              }}
            >
              填入默认值
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
export function ModelSuggestionsForm() {
  const auth = useQuery(authQuery);
  const account = auth.data?.data.account;
  const authorized = Boolean(
    account?.role === 'admin' && auth.data?.data.assurance === 'authenticated',
  );
  const accountId = authorized && account ? account.id : '';
  const query = useQuery({
    queryKey: modelSuggestionsKey(accountId),
    queryFn: ({ signal }) => modelSuggestionsApi.read(accountId, signal),
    enabled: authorized,
    retry: false,
  });
  if (!authorized) return <FormNotice error="请使用有效管理员会话维护模型建议" />;
  if (!query.data)
    return query.isPending ? (
      <div role="status">
        <span className="sr-only">正在读取模型建议…</span>
        <Skeleton className="h-64 w-full" aria-hidden="true" />
      </div>
    ) : (
      <div className="flex flex-col items-start gap-3">
        <FormNotice error={query.error} />
        <Button onClick={() => void query.refetch()}>重新读取模型建议</Button>
      </div>
    );
  return (
    <>
      {query.isError && <FormNotice error={query.error} />}
      <Fields key={accountId} accountId={accountId} initial={query.data} />
      <ModelSuggestionsRecords accountId={accountId} />
    </>
  );
}
