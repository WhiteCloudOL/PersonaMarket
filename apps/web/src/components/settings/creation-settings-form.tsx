'use client';
import { useState } from 'react';
import { FormProvider, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  CreationSettingsWriteSchema,
  type CreationSettingsWrite,
  type CreationSettingsResponse,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
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
import { authQuery } from '@/lib/auth-api';
import { creationSettingsApi, creationSettingsKey } from '@/lib/creation-settings-api';
import { FormNotice } from '../auth/auth-fields';
import { CreationSettingsInputs } from './creation-settings-inputs';
import { CreationSettingsChanges } from './creation-settings-summary';
import { SubmissionSettingsRecords } from './submission-settings-records';

import { useSettingsForm } from './use-settings-form';

function Fields({ accountId, initial }: { accountId: string; initial: CreationSettingsResponse }) {
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const { form, snapshot, busy, dirty, canSave, save, message, error } = useSettingsForm<
    Pick<CreationSettingsWrite, 'data'>,
    CreationSettingsResponse
  >({
    accountId,
    queryKey: creationSettingsKey(accountId),
    initial,
    resolver: zodResolver(CreationSettingsWriteSchema.pick({ data: true })),
    valuesFor: (result) => ({ data: result.data }),
    read: (signal) => creationSettingsApi.read(accountId, signal),
    write: (input, base, key) => creationSettingsApi.write(accountId, input, base.meta, key),
    saved: '创作设置已保存，待审版本在重新读取时使用当前提示',
  });
  const data = useWatch({ control: form.control, name: 'data' });
  return (
    <>
      <FormProvider {...form}>
        <form noValidate className="flex min-w-0 flex-col gap-6" onSubmit={form.handleSubmit(save)}>
          <fieldset
            disabled={busy}
            className="flex min-w-0 flex-col gap-6 border-0 p-0"
            aria-label="创作设置表单"
          >
            <CreationSettingsInputs />
            <FormNotice message={message} error={error} />
            <p role="status" className="text-sm text-muted-foreground">
              {dirty ? '有未保存的创作设置' : '当前表单与已读取配置一致'}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={busy || !canSave}>
                {busy ? '正在保存…' : '保存创作设置'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDefaultsOpen(true)}>
                恢复默认值
              </Button>
            </div>
          </fieldset>
        </form>
      </FormProvider>
      <AlertDialog open={defaultsOpen} onOpenChange={setDefaultsOpen}>
        <AlertDialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle>恢复创作默认值</AlertDialogTitle>
            <AlertDialogDescription>默认值会填入表单，点击保存后生效</AlertDialogDescription>
          </AlertDialogHeader>
          <div
            role="region"
            aria-label="创作默认值差异"
            tabIndex={0}
            className="min-h-0 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-ring"
          >
            <CreationSettingsChanges before={data} after={snapshot.defaults} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>保留当前输入</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                form.setValue('data', structuredClone(snapshot.defaults), {
                  shouldDirty: true,
                  shouldValidate: true,
                });
                setDefaultsOpen(false);
              }}
            >
              应用到表单
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function CreationSettingsForm() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const auth = useQuery(authQuery);
  const account = auth.data?.data.account;
  const authorized = Boolean(
    account?.role === 'admin' && auth.data?.data.assurance === 'authenticated',
  );
  const accountId = authorized && account ? account.id : '';
  const query = useQuery({
    queryKey: creationSettingsKey(accountId),
    queryFn: ({ signal }) => creationSettingsApi.read(accountId, signal),
    enabled: authorized,
    retry: false,
  });
  if (!authorized) return <FormNotice error="请使用有效管理员会话维护创作设置" />;
  if (!query.data)
    return query.isPending ? (
      <p role="status">正在读取创作设置…</p>
    ) : (
      <div className="flex flex-col items-start gap-3">
        <FormNotice error={query.error} />
        <Button onClick={() => void query.refetch()}>重新读取创作设置</Button>
      </div>
    );
  return (
    <>
      {query.isError && <FormNotice error={query.error} />}
      <Fields key={accountId} accountId={accountId} initial={query.data} />
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <CollapsibleTrigger render={<Button type="button" variant="outline" />}>
          {historyOpen ? '收起投稿策略修改记录' : '查看投稿策略修改记录'}
        </CollapsibleTrigger>
        <CollapsibleContent>
          {historyOpen && <SubmissionSettingsRecords accountId={accountId} />}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
