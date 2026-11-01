'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { PolicyWriteSchema, type ManagedPolicy, type PolicyWrite } from '@personamarket/contracts';
import { ApiError, authQuery, type readAuthContext } from '@/lib/auth-api';
import { policiesApi, policiesKey, policyDraftKey, type PolicyCommand } from './api';
import { policyFields, intentKey, type PolicyIntent, type PolicyActionValues } from './labels';

type Prepared = {
  command: PolicyCommand;
  revision: number;
  key: string;
  signature: string;
  uncertain: boolean;
  before: ManagedPolicy;
  formValues: PolicyWrite;
  actionKey?: string;
  sourceRevision?: number;
  targetTitle?: string;
};
type Draft = {
  snapshot: ManagedPolicy;
  values: PolicyWrite;
  actionValues: Record<string, PolicyActionValues>;
  command?: Prepared;
};
type Operation = { command: PolicyCommand; revision: number; original?: Prepared };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function activeAccount(client: QueryClient, accountId: string) {
  const current = client.getQueryData<Awaited<ReturnType<typeof readAuthContext>>>(
    authQuery.queryKey,
  );
  return (
    current?.data.account?.id === accountId &&
    current.data.account.role === 'admin' &&
    current.data.assurance === 'authenticated'
  );
}

export function usePolicyEditor(accountId: string, initial: ManagedPolicy) {
  const client = useQueryClient(),
    router = useRouter();
  const key = useMemo(() => policyDraftKey(accountId, initial.slug), [accountId, initial.slug]);
  const [preserved] = useState(() => client.getQueryData<Draft>(key));
  const [snapshot, setSnapshot] = useState(preserved?.snapshot ?? initial);
  const [candidate, setCandidate] = useState<ManagedPolicy>();
  // 后台读取的新响应只成为候选，不覆盖正在编辑的输入。
  const latestCandidate =
    initial.revision > snapshot.revision && (!candidate || initial.revision > candidate.revision)
      ? initial
      : candidate;
  const [intent, setIntent] = useState<PolicyIntent>();
  const [actionValues, setActionValues] = useState<Record<string, PolicyActionValues>>(
    preserved?.actionValues ?? {},
  );
  const [unresolved, setUnresolved] = useState(Boolean(preserved?.command?.uncertain));
  const [originalRequest, setOriginalRequest] = useState<Prepared | undefined>(preserved?.command);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<Error>();
  const [message, setMessage] = useState<string>();
  const command = useRef<Prepared | undefined>(preserved?.command);
  const reader = useRef<AbortController | undefined>(undefined),
    alive = useRef(true);
  const stableButton = useRef<HTMLButtonElement>(null);
  const form = useForm<PolicyWrite>({
    resolver: zodResolver(PolicyWriteSchema),
    defaultValues: preserved?.values ?? { ...policyFields(initial), reason: '' },
  });
  const [title, summary, bodyMarkdown, reason] = useWatch({
    control: form.control,
    name: ['title', 'summary', 'bodyMarkdown', 'reason'],
  });
  const values = useMemo(
    () => ({ title, summary, bodyMarkdown, reason }),
    [title, summary, bodyMarkdown, reason],
  );
  const changed = !same(policyFields(values), policyFields(snapshot));
  const dirty =
    changed ||
    Boolean(reason) ||
    unresolved ||
    Object.values(actionValues).some((value) => Boolean(value.reason) || value.selfReviewConfirmed);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      reader.current?.abort();
    };
  }, []);
  useEffect(() => {
    client.setQueryDefaults(key, { gcTime: Infinity });
  }, [client, key]);
  useEffect(() => {
    if (!activeAccount(client, accountId)) return;
    if (dirty)
      client.setQueryData(key, {
        snapshot,
        values,
        actionValues,
        ...(command.current ? { command: command.current } : {}),
      } satisfies Draft);
    else client.removeQueries({ queryKey: key, exact: true });
  }, [client, accountId, key, snapshot, values, actionValues, dirty]);

  const mutation = useMutation({
    mutationKey: [...policiesKey(accountId), 'mutations', initial.slug],
    mutationFn: (operation: Operation) => {
      if (!activeAccount(client, accountId)) throw new Error('登录账号已变化，请重新确认公共规则');
      const signature = JSON.stringify({
        command: operation.command,
        revision: operation.revision,
      });
      const prepared =
        operation.original ??
        (command.current?.signature === signature
          ? command.current
          : {
              command: structuredClone(operation.command),
              revision: operation.revision,
              signature,
              key: crypto.randomUUID(),
              uncertain: false,
              before: snapshot,
              formValues: structuredClone(form.getValues()),
              ...(intent ? { actionKey: intentKey(intent) } : {}),
              ...(intent && 'submission' in intent
                ? {
                    sourceRevision: intent.submission.sourceRevision,
                    targetTitle: intent.submission.snapshot.title,
                  }
                : {}),
            });
      command.current = prepared;
      setOriginalRequest(prepared);
      client.setQueryData(key, {
        snapshot,
        values: form.getValues(),
        actionValues,
        command: prepared,
      } satisfies Draft);
      return policiesApi.mutate(
        accountId,
        initial.slug,
        prepared.revision,
        prepared.command,
        prepared.key,
      );
    },
    retry: false,
    onSuccess: (result) => {
      if (!activeAccount(client, accountId)) return;
      const prepared = command.current;
      if (!prepared) return;
      command.current = undefined;
      const current = form.getValues();
      const expected = prepared.command.kind === 'write' ? prepared.command.input : prepared.before;
      const keepCandidate =
        !same(policyFields(result.data), policyFields(expected)) ||
        (prepared.command.kind === 'write' && !same(current, prepared.formValues));
      const nextValues =
        prepared.command.kind === 'write' && !keepCandidate
          ? { ...policyFields(result.data), reason: '' }
          : current;
      const submittedAction = {
        reason: prepared.command.input.reason,
        selfReviewConfirmed:
          prepared.command.kind === 'review' && prepared.command.input.selfReviewConfirmed,
      };
      // 核对原请求时，后来输入的下一轮理由仍是未提交输入。
      const nextActions =
        prepared.actionKey && same(actionValues[prepared.actionKey], submittedAction)
          ? { ...actionValues, [prepared.actionKey]: { reason: '', selfReviewConfirmed: false } }
          : actionValues;
      client.setQueryData([...policiesKey(accountId), 'detail', initial.slug], result);
      void client.invalidateQueries({
        queryKey: [...policiesKey(accountId), 'submissions', initial.slug],
      });
      void client.invalidateQueries({
        queryKey: [...policiesKey(accountId), 'records', initial.slug],
      });
      const nextSnapshot = keepCandidate ? snapshot : result.data;
      if (
        !same(policyFields(nextValues), policyFields(nextSnapshot)) ||
        Boolean(nextValues.reason) ||
        Object.values(nextActions).some(
          (value) => Boolean(value.reason) || value.selfReviewConfirmed,
        )
      )
        client.setQueryData(key, {
          snapshot: nextSnapshot,
          values: nextValues,
          actionValues: nextActions,
        } satisfies Draft);
      else client.removeQueries({ queryKey: key, exact: true });
      if (!alive.current) return;
      setOriginalRequest(undefined);
      setUnresolved(false);
      setReadError(undefined);
      setIntent(undefined);
      setActionValues(nextActions);
      stableButton.current?.focus();
      if (keepCandidate) {
        setCandidate(result.data);
        setMessage('操作结果已核对，服务器已有后续草稿或当前输入已变化，请核对最新修订后继续');
      } else {
        setSnapshot(result.data);
        setCandidate(undefined);
        form.reset(nextValues);
        setMessage(
          prepared.command.kind === 'write'
            ? '草稿已保存，公开版和已送审快照保持各自内容'
            : '操作已完成，当前公开版和送审状态已更新',
        );
      }
      router.refresh();
    },
    onError: (cause) => {
      if (!activeAccount(client, accountId)) return;
      const prepared = command.current;
      if (prepared) {
        const ambiguous =
          !(cause instanceof ApiError) ||
          ['SERVICE_UNAVAILABLE', 'INVALID_RESPONSE', 'INTERNAL_ERROR'].includes(cause.code);
        if (cause instanceof ApiError && cause.code === 'REVISION_CONFLICT')
          command.current = undefined;
        else prepared.uncertain = prepared.uncertain || ambiguous;
        client.setQueryData(key, {
          snapshot,
          values: form.getValues(),
          actionValues,
          ...(command.current ? { command: command.current } : {}),
        } satisfies Draft);
      }
      if (alive.current) {
        setUnresolved(Boolean(command.current?.uncertain));
        setOriginalRequest(command.current ? { ...command.current } : undefined);
      }
    },
  });
  async function readLatest() {
    reader.current?.abort();
    const controller = new AbortController();
    reader.current = controller;
    setReading(true);
    setReadError(undefined);
    try {
      const result = await policiesApi.read(accountId, initial.slug, controller.signal);
      if (alive.current && reader.current === controller) setCandidate(result.data);
    } catch (cause) {
      if (alive.current && !controller.signal.aborted)
        setReadError(cause instanceof Error ? cause : new Error('最新规则暂时无法读取'));
    } finally {
      if (alive.current && reader.current === controller) setReading(false);
    }
  }
  function adoptLatest() {
    if (!latestCandidate || unresolved) return;
    client.setQueryData([...policiesKey(accountId), 'detail', initial.slug], {
      data: latestCandidate,
    });
    setSnapshot(latestCandidate);
    setCandidate(undefined);
    command.current = undefined;
    setOriginalRequest(undefined);
    mutation.reset();
    setMessage('已采用最新修订，当前输入和处理理由已保留，请核对后重新确认操作');
  }
  function prepareIntent(next: PolicyIntent) {
    if (unresolved) {
      setMessage('请先核对原提交结果，再发起其他操作');
      return;
    }
    mutation.reset();
    setMessage(undefined);
    setIntent(next);
  }
  function submit(commandValue: PolicyCommand, revision: number) {
    if (unresolved) {
      setMessage('请先核对原提交结果，当前输入已保留');
      return;
    }
    setMessage(undefined);
    mutation.mutate({ command: commandValue, revision });
  }
  function replayOriginal() {
    const original = command.current;
    if (!original) return;
    mutation.mutate({ command: original.command, revision: original.revision, original });
  }
  function updateActionValues(next: PolicyActionValues) {
    if (intent) setActionValues((current) => ({ ...current, [intentKey(intent)]: next }));
  }
  return {
    form,
    values,
    snapshot,
    candidate: latestCandidate,
    intent,
    setIntent,
    actionValues,
    updateActionValues,
    unresolved,
    originalRequest,
    reading,
    readError,
    message,
    changed,
    dirty,
    mutation,
    busy: mutation.isPending || reading,
    stableButton,
    readLatest,
    adoptLatest,
    prepareIntent,
    submit,
    replayOriginal,
  };
}
