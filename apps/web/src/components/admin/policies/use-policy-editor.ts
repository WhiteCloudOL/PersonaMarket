'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  PolicyDraftFieldsSchema,
  type ManagedPolicy,
  type PolicyDraftFields,
} from '@personamarket/contracts';
import { ApiError, authQuery, type readAuthContext } from '@/lib/auth-api';
import { mergeSettings, isSettingsConflict, settingsConflictMessage } from '@/lib/settings-save';
import { policiesApi, policiesKey, policyDraftKey, type PolicyCommand } from './api';
import { policyFields, intentKey, type PolicyIntent, type PolicyActionValues } from './labels';

type Prepared = {
  command: PolicyCommand;
  revision: number;
  key: string;
  signature: string;
  uncertain: boolean;
  before: ManagedPolicy;
  formValues: PolicyDraftFields;
  actionKey?: string;
  sourceRevision?: number;
  targetTitle?: string;
};
type Draft = {
  snapshot: ManagedPolicy;
  values: PolicyDraftFields;
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
  const [intent, setIntent] = useState<PolicyIntent>();
  const [actionValues, setActionValues] = useState<Record<string, PolicyActionValues>>(
    preserved?.actionValues ?? {},
  );
  const [unresolved, setUnresolved] = useState(Boolean(preserved?.command?.uncertain));
  const [originalRequest, setOriginalRequest] = useState<Prepared | undefined>(preserved?.command);
  const [message, setMessage] = useState<string>();
  const command = useRef<Prepared | undefined>(preserved?.command);
  const alive = useRef(true);
  const stableButton = useRef<HTMLButtonElement>(null);
  const form = useForm<PolicyDraftFields>({
    resolver: zodResolver(PolicyDraftFieldsSchema),
    defaultValues: preserved?.values ?? policyFields(initial),
  });
  const [title, summary, bodyMarkdown] = useWatch({
    control: form.control,
    name: ['title', 'summary', 'bodyMarkdown'],
  });
  const values = useMemo(() => ({ title, summary, bodyMarkdown }), [title, summary, bodyMarkdown]);
  const changed = !same(policyFields(values), policyFields(snapshot));
  const dirty =
    changed ||
    unresolved ||
    Object.values(actionValues).some((value) => Boolean(value.reason) || value.selfReviewConfirmed);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
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
    mutationFn: async (operation: Operation) => {
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
      const send = (request: Prepared) =>
        policiesApi.mutate(accountId, initial.slug, request.revision, request.command, request.key);
      try {
        return await send(prepared);
      } catch (error) {
        if (!isSettingsConflict(error)) throw error;
        command.current = undefined;
        const latest = (await policiesApi.read(accountId, initial.slug, AbortSignal.timeout(10000)))
          .data;
        const merged = mergeSettings(
          policyFields(snapshot),
          policyFields(form.getValues()),
          policyFields(latest),
        );
        if (!activeAccount(client, accountId)) throw error;
        client.setQueryData([...policiesKey(accountId), 'detail', initial.slug], { data: latest });
        if (alive.current) {
          setSnapshot(latest);
          form.reset(merged.data);
          if (prepared.command.kind !== 'write') setIntent(undefined);
        }
        if (prepared.command.kind !== 'write') {
          throw new Error('规则状态已更新。请重新选择要执行的操作。', { cause: error });
        }
        if (merged.conflict) throw new Error(settingsConflictMessage, { cause: error });
        const updated: Prepared = {
          ...prepared,
          command: { kind: 'write', input: merged.data },
          key: crypto.randomUUID(),
          revision: latest.revision,
          before: latest,
          formValues: merged.data,
        };
        command.current = updated;
        return same(merged.data, policyFields(latest)) ? { data: latest } : send(updated);
      }
    },
    retry: false,
    onSuccess: (result) => {
      if (!activeAccount(client, accountId)) return;
      const prepared = command.current;
      if (!prepared) return;
      command.current = undefined;
      const current = form.getValues();
      const nextValues =
        prepared.command.kind === 'write'
          ? mergeSettings(prepared.formValues, current, policyFields(result.data)).data
          : current;
      const submittedAction = {
        reason: prepared.command.kind === 'write' ? '' : prepared.command.input.reason,
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
      const nextSnapshot = result.data;
      if (
        !same(policyFields(nextValues), policyFields(nextSnapshot)) ||
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
      setIntent(undefined);
      setActionValues(nextActions);
      stableButton.current?.focus();
      setSnapshot(result.data);
      form.reset(nextValues);
      setMessage(
        prepared.command.kind === 'write'
          ? same(nextValues, policyFields(result.data))
            ? '草稿已保存，公开版和已送审快照保持各自内容'
            : '先前的保存已确认，新的修改已保留。再次点击保存即可提交。'
          : '操作已完成，当前公开版和送审状态已更新',
      );
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
      if (command.current?.command.kind === 'write') replayOriginal();
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
    intent,
    setIntent,
    actionValues,
    updateActionValues,
    unresolved,
    originalRequest,
    message,
    changed,
    dirty,
    mutation,
    busy: mutation.isPending,
    stableButton,
    prepareIntent,
    submit,
    replayOriginal,
  };
}
