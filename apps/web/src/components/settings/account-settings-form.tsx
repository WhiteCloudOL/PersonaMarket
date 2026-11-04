'use client';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AccountSettingsWriteSchema,
  type AccountSettingsWrite,
  type AccountSettingsResponse,
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
import { accountSettingsApi, accountSettingsKey } from '@/lib/account-settings-api';
import { FormNotice } from '../auth/auth-fields';
import { AccountSettingsInputs } from './account-settings-inputs';
import { AccountSettingsChanges } from './account-settings-summary';
import { AccountSettingsRecords } from './account-settings-records';

import { useSettingsForm } from './use-settings-form';

function Fields({ accountId, initial }: { accountId: string; initial: AccountSettingsResponse }) {
  const client = useQueryClient();
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const { form, snapshot, busy, dirty, canSave, save, message, error } = useSettingsForm<
    Pick<AccountSettingsWrite, 'data'>,
    AccountSettingsResponse
  >({
    accountId,
    queryKey: accountSettingsKey(accountId),
    initial,
    resolver: zodResolver(AccountSettingsWriteSchema.pick({ data: true })),
    valuesFor: (result) => ({ data: result.data }),
    read: (signal) => accountSettingsApi.read(accountId, signal),
    write: (input, base, key) => accountSettingsApi.write(accountId, input, base.meta, key),
    saved: '注册设置已保存，新注册和之后创建的完整会话使用当前策略',
    onSaved: () => void client.invalidateQueries({ queryKey: authQuery.queryKey }),
  });
  const data = useWatch({ control: form.control, name: 'data' });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const invalidField = useRef<
    | 'data.sessionTtlSeconds'
    | 'data.registrationRateLimit.maxAttempts'
    | 'data.registrationRateLimit.windowSeconds'
    | undefined
  >(undefined);
  useEffect(() => {
    if (advancedOpen && invalidField.current) {
      form.setFocus(invalidField.current);
      invalidField.current = undefined;
    }
  }, [advancedOpen, form]);
  return (
    <>
      <FormProvider {...form}>
        <form
          noValidate
          className="flex min-w-0 flex-col gap-6"
          onSubmit={(event) => {
            void form.handleSubmit(save, (errors) => {
              const field = errors.data?.registrationRateLimit?.maxAttempts
                ? 'data.registrationRateLimit.maxAttempts'
                : errors.data?.registrationRateLimit?.windowSeconds
                  ? 'data.registrationRateLimit.windowSeconds'
                  : errors.data?.sessionTtlSeconds
                    ? 'data.sessionTtlSeconds'
                    : undefined;
              if (field) {
                if (advancedOpen) {
                  form.setFocus(field);
                } else {
                  invalidField.current = field;
                  setAdvancedOpen(true);
                }
              }
            })(event);
          }}
        >
          <fieldset
            disabled={busy}
            className="flex min-w-0 flex-col gap-6 border-0 p-0"
            aria-label="注册设置表单"
          >
            <AccountSettingsInputs
              advancedOpen={advancedOpen}
              onAdvancedOpenChange={setAdvancedOpen}
            />
            <FormNotice message={message} error={error} />
            <p role="status" className="text-sm text-muted-foreground">
              {dirty ? '有未保存的注册设置' : '当前表单与已读取配置一致'}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={busy || !canSave}>
                {busy ? '正在保存…' : '保存注册设置'}
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
            <AlertDialogTitle>恢复注册默认值</AlertDialogTitle>
            <AlertDialogDescription>默认值会填入表单，点击保存后生效</AlertDialogDescription>
          </AlertDialogHeader>
          <div
            role="region"
            aria-label="注册默认值差异"
            tabIndex={0}
            className="min-h-0 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-ring"
          >
            <AccountSettingsChanges before={data} after={snapshot.defaults} />
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

export function AccountSettingsForm() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const auth = useQuery(authQuery);
  const account = auth.data?.data.account;
  const authorized = Boolean(
    account?.role === 'admin' && auth.data?.data.assurance === 'authenticated',
  );
  const accountId = authorized && account ? account.id : '';
  const query = useQuery({
    queryKey: accountSettingsKey(accountId),
    queryFn: ({ signal }) => accountSettingsApi.read(accountId, signal),
    enabled: authorized,
    retry: false,
  });
  if (!authorized) return <FormNotice error="请使用有效管理员会话维护注册设置" />;
  if (!query.data)
    return query.isPending ? (
      <p role="status">正在读取注册设置…</p>
    ) : (
      <div className="flex flex-col items-start gap-3">
        <FormNotice error={query.error} />
        <Button onClick={() => void query.refetch()}>重新读取注册设置</Button>
      </div>
    );
  return (
    <>
      {query.isError && <FormNotice error={query.error} />}
      <Fields key={accountId} accountId={accountId} initial={query.data} />
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <CollapsibleTrigger render={<Button type="button" variant="outline" />}>
          {historyOpen ? '收起注册策略修改记录' : '查看注册策略修改记录'}
        </CollapsibleTrigger>
        <CollapsibleContent>
          {historyOpen && <AccountSettingsRecords accountId={accountId} />}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
