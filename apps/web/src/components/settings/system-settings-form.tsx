'use client';
import { useState } from 'react';
import { FormProvider, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SystemSettingsWriteSchema,
  type SystemSettingsWrite,
  type SystemSettingsResponse,
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
import { systemSettingsApi, systemSettingsKey } from '@/lib/system-settings-api';
import { FormNotice } from '../auth/auth-fields';
import { SystemSettingsInputs } from './system-settings-inputs';
import { SystemSettingsChanges } from './system-settings-summary';
import { SystemSettingsRecords } from './system-settings-records';
import { SystemSettingsRuntime } from './system-settings-runtime';
import { publicSystemStatusKey } from '@/lib/system-status-api';
import { useHydrationReady } from '@/lib/use-hydration-ready';

import { useSettingsForm } from './use-settings-form';

function Fields({ accountId, initial }: { accountId: string; initial: SystemSettingsResponse }) {
  const client = useQueryClient();
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const { form, snapshot, busy, dirty, canSave, save, message, error } = useSettingsForm<
    Pick<SystemSettingsWrite, 'data'>,
    SystemSettingsResponse
  >({
    accountId,
    queryKey: systemSettingsKey(accountId),
    initial,
    resolver: zodResolver(SystemSettingsWriteSchema.pick({ data: true })),
    valuesFor: (result) => ({ data: result.data }),
    read: (signal) => systemSettingsApi.read(accountId, signal),
    write: (input, base, key) =>
      systemSettingsApi.write(accountId, { ...input, confirmed: true }, base.meta, key),
    saved: '维护设置已保存，新普通业务提交按当前维护状态处理',
    onSaved: () => void client.invalidateQueries({ queryKey: publicSystemStatusKey }),
  });
  const data = useWatch({ control: form.control, name: 'data' });
  return (
    <>
      <FormProvider {...form}>
        <form noValidate className="flex min-w-0 flex-col gap-6" onSubmit={form.handleSubmit(save)}>
          <fieldset
            disabled={busy}
            className="flex min-w-0 flex-col gap-6 border-0 p-0"
            aria-label="维护设置表单"
          >
            <SystemSettingsInputs />
            <FormNotice message={message} error={error} />
            <p role="status" className="text-sm text-muted-foreground">
              {dirty ? '有未保存的维护设置' : '当前表单与已读取配置一致'}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={busy || !canSave}>
                {busy ? '正在保存…' : '保存维护设置'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDefaultsOpen(true)}>
                恢复部署默认值
              </Button>
            </div>
          </fieldset>
        </form>
      </FormProvider>
      <AlertDialog open={defaultsOpen} onOpenChange={setDefaultsOpen}>
        <AlertDialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle>恢复维护默认值</AlertDialogTitle>
            <AlertDialogDescription>默认值会填入表单，点击保存后生效</AlertDialogDescription>
          </AlertDialogHeader>
          <div
            role="region"
            aria-label="维护默认值差异"
            tabIndex={0}
            className="min-h-0 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-ring"
          >
            <SystemSettingsChanges before={data} after={snapshot.defaults} />
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

export function SystemSettingsForm() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const hydrated = useHydrationReady();
  const auth = useQuery(authQuery);
  const account = auth.data?.data.account;
  const authorized = Boolean(
    hydrated && account?.role === 'admin' && auth.data?.data.assurance === 'authenticated',
  );
  const accountId = authorized && account ? account.id : '';
  const query = useQuery({
    queryKey: systemSettingsKey(accountId),
    queryFn: ({ signal }) => systemSettingsApi.read(accountId, signal),
    enabled: authorized,
    retry: false,
  });
  if (!hydrated || auth.isPending) return <p role="status">正在校验管理员身份…</p>;
  if (!authorized) return <FormNotice error="请使用有效管理员会话维护维护设置" />;
  if (!query.data)
    return query.isPending ? (
      <p role="status">正在读取维护设置…</p>
    ) : (
      <div className="flex flex-col items-start gap-3">
        <FormNotice error={query.error} />
        <Button onClick={() => void query.refetch()}>重新读取维护设置</Button>
      </div>
    );
  return (
    <>
      {query.isError && <FormNotice error={query.error} />}
      <Fields key={accountId} accountId={accountId} initial={query.data} />
      <SystemSettingsRuntime key={'runtime-' + accountId} accountId={accountId} />
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <CollapsibleTrigger render={<Button type="button" variant="outline" />}>
          {historyOpen ? '收起维护设置修改记录' : '查看维护设置修改记录'}
        </CollapsibleTrigger>
        <CollapsibleContent>
          {historyOpen && <SystemSettingsRecords accountId={accountId} />}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
