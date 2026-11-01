'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type RankingSettingsWrite, type RankingSettingsResponse } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
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
import { Spinner } from '@personamarket/ui/components/spinner';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { cn } from '@personamarket/ui/lib/utils';
import { authQuery, ApiError } from '@/lib/auth-api';
import { rankingSettingsApi, rankingSettingsKey } from '@/lib/ranking-settings-api';
import { useSettingsDirty } from './settings-navigation';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { EditorSection } from '../personas/editor-section';
import { FormNotice } from '../auth/auth-fields';
import { RankingSettingsInputs } from './ranking-settings-inputs';
import { RankingSettingsWriteSchema as RankingSettingsFormSchema } from '@personamarket/contracts';
import { RankingRuntime } from './ranking-runtime';
import { RankingSettingsSummary } from './ranking-settings-summary';
import { RankingSettingsRecords } from './ranking-settings-records';
import { announcementDate } from '../announcements/announcement-content';

type Command = {
  signature: string;
  key: string;
  input: RankingSettingsWrite;
  revision: number;
  uncertain: boolean;
};
type Draft = { snapshot: RankingSettingsResponse; values: RankingSettingsWrite; command?: Command };
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
const settingsNavigationHandlesDiscard = (target: URL, current: URL) =>
  target.origin === current.origin && target.pathname.startsWith('/admin/settings/');
function Fields({ accountId, initial }: { accountId: string; initial: RankingSettingsResponse }) {
  const constrained = useSyncExternalStore(subscribeViewport, constrainedViewport, serverViewport);
  const client = useQueryClient(),
    router = useRouter();
  const draftKey = useMemo(() => [...rankingSettingsKey(accountId), 'draft'], [accountId]);
  const [preserved] = useState(() => client.getQueryData<Draft>(draftKey));
  const [unresolved, setUnresolved] = useState(Boolean(preserved?.command?.uncertain));
  const [snapshot, setSnapshot] = useState(preserved?.snapshot ?? initial);
  const [candidate, setCandidate] = useState<RankingSettingsResponse>();
  const [reading, setReading] = useState(false),
    [defaultsOpen, setDefaultsOpen] = useState(false);
  const [readError, setReadError] = useState<Error>();
  const [pendingSubmit, setPendingSubmit] = useState<RankingSettingsWrite>();
  const [message, setMessage] = useState<string>();
  const latestButton = useRef<HTMLButtonElement>(null);
  const [confirmedSubmit, setConfirmedSubmit] = useState(false);
  const command = useRef<Command | undefined>(preserved?.command);
  const reader = useRef<AbortController | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      reader.current?.abort();
    };
  }, []);
  const form = useForm<RankingSettingsWrite>({
    resolver: zodResolver(RankingSettingsFormSchema),
    defaultValues: preserved?.values ?? { data: snapshot.data, reason: '' },
  });
  const [data, reason] = useWatch({ control: form.control, name: ['data', 'reason'] });
  const changed = JSON.stringify(data) !== JSON.stringify(snapshot.data);
  const dirty = changed || Boolean(reason) || unresolved;
  useEffect(() => {
    // 草稿没有查询观察者，避免默认回收在停留期间清空输入；账号切换和主动退出仍统一清理私有缓存
    client.setQueryDefaults(draftKey, { gcTime: Infinity });
  }, [client, draftKey]);
  useEffect(() => {
    if (dirty)
      client.setQueryData(draftKey, {
        snapshot,
        values: { data, reason },
        ...(command.current ? { command: command.current } : {}),
      } satisfies Draft);
    else client.removeQueries({ queryKey: draftKey, exact: true });
  }, [client, draftKey, snapshot, data, reason, dirty]);
  const mutation = useMutation({
    mutationFn: (input: RankingSettingsWrite) => {
      const signature = JSON.stringify({ input, revision: snapshot.meta.revision });
      const prepared =
        command.current?.signature === signature
          ? command.current
          : {
              signature,
              key: crypto.randomUUID(),
              input: structuredClone(input),
              revision: snapshot.meta.revision,
              uncertain: true,
            };
      command.current = prepared;
      client.setQueryData(draftKey, {
        snapshot,
        values: form.getValues(),
        command: prepared,
      } satisfies Draft);
      return rankingSettingsApi.write(accountId, prepared.input, prepared.revision, prepared.key);
    },
    retry: false,
    onSuccess: (result, input) => {
      if (!alive.current) return;
      setUnresolved(false);
      // 普通保存也会移除保存栏，先把焦点交给稳定入口；确认窗则通过 finalFocus 恢复
      if (!pendingSubmit) latestButton.current?.focus();
      // 幂等重放可能读到首次提交之后的新修订，不能据此覆盖仍待确认的本地输入
      if (
        JSON.stringify(result.data) !== JSON.stringify(input.data) ||
        JSON.stringify(form.getValues()) !== JSON.stringify(input)
      ) {
        setCandidate(result);
        setReadError(undefined);
        command.current = undefined;
        client.setQueryData(draftKey, { snapshot, values: form.getValues() } satisfies Draft);
        client.setQueryData(rankingSettingsKey(accountId), result);

        void client.invalidateQueries({ queryKey: rankingSettingsKey(accountId) });
        setMessage(
          JSON.stringify(result.data) !== JSON.stringify(input.data)
            ? '服务器已有后续修订，当前输入已保留，请核对最新内容后再保存'
            : '原提交结果已核对，当前输入已保留，请核对后再保存',
        );
        router.refresh();
        return;
      }
      setSnapshot(result);
      form.reset({ data: result.data, reason: '' });
      setCandidate(undefined);
      setReadError(undefined);
      command.current = undefined;
      client.removeQueries({ queryKey: draftKey, exact: true });
      client.setQueryData(rankingSettingsKey(accountId), result);

      void client.invalidateQueries({ queryKey: rankingSettingsKey(accountId) });
      setMessage('排行与运营设置已保存，已提交新批次计算请求，计算完成后更新榜单');
      router.refresh();
    },
    onError: (cause) => {
      if (!alive.current) return;
      const prepared = command.current;
      if (prepared) {
        const ambiguous =
          !(cause instanceof ApiError) ||
          ['SERVICE_UNAVAILABLE', 'INVALID_RESPONSE', 'INTERNAL_ERROR'].includes(cause.code);
        if (
          ambiguous ||
          (prepared.uncertain && !(cause instanceof ApiError && cause.code === 'REVISION_CONFLICT'))
        )
          prepared.uncertain = true;
        else command.current = undefined;
        setUnresolved(Boolean(command.current?.uncertain));
        client.setQueryData(draftKey, {
          snapshot,
          values: form.getValues(),
          ...(command.current ? { command: command.current } : {}),
        } satisfies Draft);
      }
    },
    onSettled: () => {
      if (alive.current) setPendingSubmit(undefined);
    },
  });
  useSettingsDirty(dirty || mutation.isPending);
  useUnsavedDraft(
    dirty || mutation.isPending,
    '还有未保存的排行与运营设置，确定离开吗',
    settingsNavigationHandlesDiscard,
  );
  async function readLatest() {
    setReading(true);
    setReadError(undefined);
    const controller = new AbortController();
    reader.current = controller;
    try {
      const result = await rankingSettingsApi.read(accountId, controller.signal);
      if (alive.current) setCandidate(result);
    } catch (cause) {
      if (alive.current)
        setReadError(cause instanceof Error ? cause : new Error('最新排行与运营设置暂时无法读取'));
    } finally {
      if (alive.current) setReading(false);
    }
  }
  const busy = mutation.isPending || reading;
  return (
    <>
      <FormNotice message={message} />
      <p className="text-sm text-muted-foreground">
        当前核对修订 {snapshot.meta.revision} ·{' '}
        {snapshot.meta.updatedBy ? '修改人 ' + snapshot.meta.updatedBy : '暂无修改记录'} · 更新于{' '}
        {announcementDate(snapshot.meta.updatedAt)}
      </p>
      <RankingRuntime accountId={accountId} expectedRevision={snapshot.meta.revision} />
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 max-w-full py-2 whitespace-normal"
          disabled={busy}
          onClick={() => setDefaultsOpen(true)}
        >
          预览默认设置
        </Button>
        <Button
          ref={latestButton}
          type="button"
          variant="outline"
          className="h-auto min-h-11 max-w-full py-2 whitespace-normal"
          aria-disabled={busy}
          onClick={() => {
            if (!busy) void readLatest();
          }}
        >
          {reading ? '正在读取…' : '核对最新排行与运营设置'}
        </Button>
      </div>
      <form
        noValidate
        onSubmit={form.handleSubmit((value) => {
          setMessage(undefined);
          if (unresolved) {
            setMessage('原提交结果仍待核对，请先核对原提交结果，当前输入已保留');
            return;
          }
          const old = snapshot.data,
            next = value.data;
          if (JSON.stringify(old) === JSON.stringify(next)) {
            setMessage('配置没有变化，请继续核对');
            return;
          }
          {
            setConfirmedSubmit(false);
            setPendingSubmit(structuredClone(value));
          }
        })}
        className="flex min-w-0 flex-col gap-5"
      >
        <fieldset
          disabled={mutation.isPending}
          aria-label="排行与运营设置表单"
          className="flex min-w-0 flex-col gap-5 border-0 p-0 [&_input]:scroll-mb-36 [&_textarea]:scroll-mb-36"
        >
          <RankingSettingsInputs form={form} disabled={busy} />
          <EditorSection
            title="记录修改依据"
            description="保存后留下具体差异和理由，未保存的输入在页面间暂存，刷新页面后不保留"
          >
            <Field data-invalid={Boolean(form.formState.errors.reason)}>
              <FieldLabel htmlFor="ranking-settings-reason">处理理由</FieldLabel>
              <Textarea
                id="ranking-settings-reason"
                className="max-h-[40dvh] min-h-28 overflow-y-auto"
                autoComplete="off"
                {...form.register('reason')}
                disabled={busy}
                aria-invalid={Boolean(form.formState.errors.reason)}
              />
              <FieldDescription>最多 2,000 字，保留输入的换行和空白</FieldDescription>
              <FieldError errors={[form.formState.errors.reason]} />
            </Field>
          </EditorSection>
          <FormNotice error={mutation.error ?? readError} />
          {unresolved && (
            <Alert role="status">
              <AlertTitle>原提交结果待核对</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3">
                <p>
                  原请求、修订和幂等标识已在当前账号的页面间暂存，核对时使用原请求，不自动提交当前改动
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const original = command.current;
                    if (original) mutation.mutate(original.input);
                  }}
                >
                  核对原提交结果
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {candidate && (
            <Alert role="status">
              <AlertTitle>最新排行与运营设置 · 修订 {candidate.meta.revision}</AlertTitle>
              <AlertDescription className="flex min-w-0 flex-col gap-4">
                <RankingSettingsSummary value={candidate.data} />
                <p>采用最新修订后，当前输入会保留，请逐项核对后手动保存</p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 max-w-full py-2 whitespace-normal"
                  disabled={busy || unresolved}
                  onClick={() => {
                    setSnapshot(candidate);
                    setCandidate(undefined);
                    command.current = undefined;
                    mutation.reset();
                  }}
                >
                  采用最新修订继续核对
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {(dirty || mutation.isPending) && (
            <div
              role="group"
              aria-label="排行与运营保存操作"
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-panel',
                !constrained && 'sticky bottom-[max(1rem,env(safe-area-inset-bottom))]',
              )}
            >
              <p role="status" className="basis-full text-sm text-muted-foreground">
                {mutation.isPending ? '正在保存，请等待结果' : '有未保存的排行与运营设置'}
              </p>
              <Button
                type="submit"
                disabled={busy || !changed}
                className="h-auto min-h-11 max-w-full py-2 whitespace-normal"
              >
                {mutation.isPending && (
                  <Spinner
                    data-icon="inline-start"
                    aria-hidden="true"
                    className="motion-reduce:animate-none"
                  />
                )}
                {mutation.isPending ? '正在保存…' : '保存排行与运营设置'}
              </Button>
            </div>
          )}
        </fieldset>
      </form>
      <AlertDialog
        open={Boolean(pendingSubmit)}
        onOpenChange={(open, details) => {
          if (!open && mutation.isPending) {
            details.cancel();
            return;
          }
          if (!open) setPendingSubmit(undefined);
        }}
      >
        <AlertDialogContent
          finalFocus={() => (confirmedSubmit ? latestButton.current : true)}
          className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-y-auto overscroll-contain"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>确认调整榜单计算规则</AlertDialogTitle>
            <AlertDialogDescription>
              保存后创建新计算请求；旧榜单继续展示，直到新批次完成，历史批次保留排队时的参数
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingSubmit && <RankingSettingsSummary value={pendingSubmit.data} />}
          {mutation.isPending && <p role="status">正在保存，请等待结果</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>返回核对</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={() => {
                if (pendingSubmit && !mutation.isPending) {
                  setConfirmedSubmit(true);
                  mutation.mutate(pendingSubmit);
                }
              }}
            >
              {mutation.isPending ? '正在保存…' : '确认并保存'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={defaultsOpen} onOpenChange={setDefaultsOpen}>
        <AlertDialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <AlertDialogHeader className="shrink-0">
            <AlertDialogTitle>核对排行与运营默认设置</AlertDialogTitle>
            <AlertDialogDescription>
              确认后只填入表单，填写理由并保存后才公开生效
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div
            role="region"
            aria-label="排行与运营默认设置对照"
            tabIndex={0}
            className="grid min-h-0 gap-5 overflow-y-auto overscroll-contain rounded-lg focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-2"
          >
            <section className="flex min-w-0 flex-col gap-3">
              <h3 className="font-semibold">当前输入</h3>
              <RankingSettingsSummary value={data} />
            </section>
            <section className="flex min-w-0 flex-col gap-3">
              <h3 className="font-semibold">默认设置</h3>
              <RankingSettingsSummary value={snapshot.defaults} />
            </section>
          </div>
          <AlertDialogFooter className="shrink-0">
            <AlertDialogCancel>保留当前输入</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                form.reset({
                  data: structuredClone(snapshot.defaults),
                  reason: form.getValues('reason'),
                });
                setMessage(undefined);
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
export function RankingSettingsForm() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const auth = useQuery(authQuery);
  const account = auth.data?.data.account;
  const authorized = Boolean(
    account?.role === 'admin' && auth.data?.data.assurance === 'authenticated',
  );
  const accountId = authorized && account ? account.id : '';
  const query = useQuery({
    queryKey: rankingSettingsKey(accountId),
    queryFn: ({ signal }) => rankingSettingsApi.read(accountId, signal),
    enabled: authorized,
    retry: false,
  });
  if (!authorized) return <FormNotice error="请使用有效管理员会话维护排行与运营" />;
  if (!query.data)
    return query.isPending ? (
      <div role="status">
        <span className="sr-only">正在读取排行与运营设置…</span>
        <Skeleton className="h-64 w-full" aria-hidden="true" />
      </div>
    ) : (
      <div className="flex flex-col items-start gap-3">
        <FormNotice error={query.error} />
        <Button onClick={() => void query.refetch()}>重新读取排行与运营设置</Button>
      </div>
    );
  return (
    <>
      {query.isError && <FormNotice error={query.error} />}
      <Fields key={accountId} accountId={accountId} initial={query.data} />
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <CollapsibleTrigger render={<Button type="button" variant="outline" />}>
          {historyOpen ? '收起修改记录' : '查看修改记录'}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          {historyOpen && <RankingSettingsRecords accountId={accountId} />}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
