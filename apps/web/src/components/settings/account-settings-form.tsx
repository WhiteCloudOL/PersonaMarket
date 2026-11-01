'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  canonicalJson,
  AccountSettingsWriteSchema,
  type AccountSettingsWrite,
  type AccountSettingsResponse,
  type AuthContextResponse,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
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
import { ApiError, authQuery } from '@/lib/auth-api';
import { accountSettingsApi, accountSettingsKey } from '@/lib/account-settings-api';
import { useSettingsDirty } from './settings-navigation';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { FormNotice } from '../auth/auth-fields';
import { AccountSettingsInputs } from './account-settings-inputs';
import { AccountSettingsSummary, AccountSettingsChanges } from './account-settings-summary';
import { AccountSettingsRecords } from './account-settings-records';

type Command = {
  input: AccountSettingsWrite;
  expected: AccountSettingsResponse['meta'];
  key: string;
  signature: string;
  uncertain: boolean;
};
type Draft = {
  snapshot: AccountSettingsResponse;
  values: AccountSettingsWrite;
  original?: Command | undefined;
  candidate?: AccountSettingsResponse | undefined;
};
const retainsSettingsDraft = (target: URL, current: URL) =>
  target.origin === current.origin && target.pathname.startsWith('/admin/settings/');
function Fields({ accountId, initial }: { accountId: string; initial: AccountSettingsResponse }) {
  const client = useQueryClient();
  const draftKey = useMemo(() => [...accountSettingsKey(accountId), 'draft'], [accountId]);
  const [preserved] = useState(() => client.getQueryData<Draft>(draftKey));
  const [snapshot, setSnapshot] = useState(preserved?.snapshot ?? initial);
  const [original, setOriginal] = useState<Command | undefined>(preserved?.original);
  const [candidate, setCandidate] = useState<AccountSettingsResponse | undefined>(
    preserved?.candidate,
  );
  const [pendingSubmit, setPendingSubmit] = useState<AccountSettingsWrite>();
  const [confirmed, setConfirmed] = useState(false);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const invalidField = useRef<
    | 'data.sessionTtlSeconds'
    | 'data.registrationRateLimit.maxAttempts'
    | 'data.registrationRateLimit.windowSeconds'
    | undefined
  >(undefined);
  const [message, setMessage] = useState<string>();
  const [readError, setReadError] = useState<Error>();
  const [reading, setReading] = useState(false);
  const reader = useRef<AbortController | undefined>(undefined);
  const alive = useRef(true);
  const latestButton = useRef<HTMLButtonElement>(null),
    saveButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      reader.current?.abort();
    };
  }, []);
  const form = useForm<AccountSettingsWrite>({
    resolver: zodResolver(AccountSettingsWriteSchema),
    defaultValues: preserved?.values ?? { data: snapshot.data, reason: '' },
  });
  useEffect(() => {
    if (advancedOpen && invalidField.current) {
      form.setFocus(invalidField.current);
      invalidField.current = undefined;
    }
  }, [advancedOpen, form]);
  const [data, reason] = useWatch({ control: form.control, name: ['data', 'reason'] });
  const dirty = canonicalJson(data) !== canonicalJson(snapshot.data) || Boolean(reason);
  useEffect(() => {
    client.setQueryDefaults(draftKey, { gcTime: Infinity });
  }, [client, draftKey]);
  useEffect(() => {
    const active = client.getQueryData<AuthContextResponse>(authQuery.queryKey)?.data;
    if (
      active?.account?.id !== accountId ||
      active.account.role !== 'admin' ||
      active.assurance !== 'authenticated'
    )
      return;
    if (dirty || original || candidate)
      client.setQueryData(draftKey, {
        snapshot,
        values: { data, reason },
        original,
        candidate,
      } satisfies Draft);
    else client.removeQueries({ queryKey: draftKey, exact: true });
  }, [client, draftKey, accountId, snapshot, data, reason, dirty, original, candidate]);
  const sameAccount = () => {
    const current = client.getQueryData<AuthContextResponse>(authQuery.queryKey)?.data;
    return (
      current?.account?.id === accountId &&
      current.account.role === 'admin' &&
      current.assurance === 'authenticated'
    );
  };
  const mutation = useMutation({
    mutationFn: (command: Command) =>
      accountSettingsApi.write(accountId, command.input, command.expected, command.key),
    retry: false,
    onMutate: () => {
      if (!alive.current || !sameAccount()) return;
      setMessage(undefined);
      setReadError(undefined);
    },
    onSuccess: (result, command) => {
      if (!sameAccount()) return;
      client.setQueryData(accountSettingsKey(accountId), result);
      void client.invalidateQueries({ queryKey: [...accountSettingsKey(accountId), 'records'] });
      void client.invalidateQueries({ queryKey: authQuery.queryKey });
      if (!alive.current) {
        const saved = client.getQueryData<Draft>(draftKey);
        if (saved) {
          if (canonicalJson(result.data) !== canonicalJson(command.input.data))
            client.setQueryData(draftKey, { ...saved, original: undefined, candidate: result });
          else if (canonicalJson(saved.values) === canonicalJson(command.input))
            client.removeQueries({ queryKey: draftKey, exact: true });
          else
            client.setQueryData(draftKey, {
              ...saved,
              snapshot: result,
              original: undefined,
              candidate: undefined,
            });
        }
        return;
      }
      setOriginal(undefined);
      setReadError(undefined);
      if (canonicalJson(result.data) !== canonicalJson(command.input.data)) {
        setCandidate(result);
        setMessage('原请求已完成，服务器已有后续修订，当前输入已保留，请核对最新内容');
        return;
      }
      setSnapshot(result);
      setCandidate(undefined);
      if (canonicalJson(form.getValues()) === canonicalJson(command.input)) {
        form.reset({ data: result.data, reason: '' });
        client.removeQueries({ queryKey: draftKey, exact: true });
        setMessage('注册设置已保存，新注册和之后创建的完整会话使用当前策略');
      } else {
        setMessage('原提交结果已核实，后续输入仍保留，请再次核对后保存');
      }
      latestButton.current?.focus();
    },
    onError: (error, command) => {
      if (!sameAccount()) return;
      // 核对被限流或要求重新验证，也不能证明先前结果未知的写入没有完成。
      const uncertain =
        command.uncertain ||
        !(error instanceof ApiError) ||
        ['INTERNAL_ERROR', 'SERVICE_UNAVAILABLE'].includes(error.code);
      const retained = uncertain ? { ...command, uncertain: true } : undefined;
      if (alive.current) {
        setOriginal(retained);
        if (uncertain) setMessage('保存结果尚不确定，请先核对原提交结果，当前输入和原请求已保留');
      } else {
        const saved = client.getQueryData<Draft>(draftKey);
        if (saved) client.setQueryData(draftKey, { ...saved, original: retained });
      }
    },
    onSettled: () => {
      if (alive.current) setPendingSubmit(undefined);
    },
  });
  useSettingsDirty(dirty || mutation.isPending || Boolean(original?.uncertain));
  useUnsavedDraft(
    dirty || mutation.isPending || Boolean(original?.uncertain),
    '还有未保存或待核对的注册设置，确定离开吗',
    retainsSettingsDraft,
  );
  async function readLatest() {
    setReading(true);
    setReadError(undefined);
    const controller = new AbortController();
    reader.current = controller;
    try {
      const result = await accountSettingsApi.read(accountId, controller.signal);
      if (alive.current && sameAccount()) setCandidate(result);
    } catch (cause) {
      if (alive.current && sameAccount())
        setReadError(cause instanceof Error ? cause : new Error('最新注册设置暂时无法读取'));
    } finally {
      if (alive.current && sameAccount()) setReading(false);
    }
  }
  const busy = mutation.isPending || reading;
  const send = (input: AccountSettingsWrite) => {
    const signature = canonicalJson({ input, expected: snapshot.meta });
    const command =
      original?.signature === signature
        ? original
        : {
            input: structuredClone(input),
            expected: { ...snapshot.meta },
            key: crypto.randomUUID(),
            signature,
            uncertain: false,
          };
    client.setQueryData(draftKey, {
      snapshot,
      values: form.getValues(),
      original: command,
      candidate,
    } satisfies Draft);
    setOriginal(command);
    mutation.mutate(command);
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">已读取修订 {snapshot.meta.revision}</p>
        <Button
          ref={latestButton}
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void readLatest()}
        >
          {reading ? '正在读取…' : '核对最新注册设置'}
        </Button>
      </div>
      <FormNotice message={message} />
      <FormNotice error={mutation.error ?? readError} />
      {original?.uncertain && (
        <Alert>
          <AlertTitle>原提交结果需要核对</AlertTitle>
          <AlertDescription className="flex min-w-0 flex-col items-start gap-3">
            <p>
              原请求基于注册设置修订 {original.expected.revision}
              ；核对使用同一幂等标识，不会再次写入已成功的设置
            </p>
            <AccountSettingsSummary value={original.input.data} />
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              原处理理由：{original.input.reason}
            </p>
            <Button type="button" disabled={busy} onClick={() => mutation.mutate(original)}>
              核对原提交结果
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {candidate && (
        <Alert>
          <AlertTitle>已读取服务器最新设置</AlertTitle>
          <AlertDescription className="flex min-w-0 flex-col gap-3">
            <p>已读取修订 {candidate.meta.revision}</p>
            <AccountSettingsSummary value={candidate.data} />
            <p>采用修订后保留当前输入，再次确认保存会按当前表单更新注册与会话策略</p>
            <Button
              type="button"
              variant="outline"
              disabled={busy || Boolean(original?.uncertain)}
              onClick={() => {
                setSnapshot(candidate);
                setCandidate(undefined);
                mutation.reset();
                setMessage('已采用最新修订，当前输入和理由仍保留，请再次核对保存');
              }}
            >
              采用最新修订保留输入
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <FormProvider {...form}>
        <form
          noValidate
          className="flex min-w-0 flex-col gap-6"
          onSubmit={(event) => {
            void form.handleSubmit(
              (input) => {
                setConfirmed(false);
                setPendingSubmit(structuredClone(input));
              },
              (errors) => {
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
              },
            )(event);
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
            <p role="status" className="text-sm text-muted-foreground">
              {dirty ? '有未保存的注册设置' : '当前表单与已读取配置一致'}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                ref={saveButton}
                type="submit"
                disabled={busy || Boolean(original?.uncertain)}
              >
                {mutation.isPending ? '正在保存…' : '保存注册设置'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDefaultsOpen(true)}>
                恢复部署默认值
              </Button>
            </div>
          </fieldset>
        </form>
      </FormProvider>
      <AlertDialog
        open={Boolean(pendingSubmit)}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setPendingSubmit(undefined);
        }}
      >
        <AlertDialogContent
          className="flex max-h-[calc(100dvh-2rem)] flex-col"
          finalFocus={() => (confirmed ? latestButton.current : saveButton.current)}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>确认保存注册设置</AlertDialogTitle>
            <AlertDialogDescription>
              注册策略立即影响新注册；会话期限仅影响之后创建的完整会话，未验证邮箱的公开写入限制保持
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div
            role="region"
            aria-label="待保存注册设置"
            tabIndex={0}
            className="min-h-0 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-ring"
          >
            {pendingSubmit && (
              <div className="flex min-w-0 flex-col gap-4">
                <AccountSettingsSummary value={pendingSubmit.data} />
                <p className="whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]">
                  处理理由：{pendingSubmit.reason}
                </p>
              </div>
            )}
          </div>
          {mutation.isPending && <p role="status">正在保存，请等待结果</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>返回核对</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={() => {
                if (pendingSubmit && !mutation.isPending) {
                  setConfirmed(true);
                  send(pendingSubmit);
                }
              }}
            >
              确认并保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={defaultsOpen} onOpenChange={setDefaultsOpen}>
        <AlertDialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle>恢复注册默认值</AlertDialogTitle>
            <AlertDialogDescription>
              只填入当前表单，保留处理理由，核对并保存后才生效
            </AlertDialogDescription>
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
