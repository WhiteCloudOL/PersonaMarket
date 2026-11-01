'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AuthContextResponseSchema,
  OperationalTaskCommandSchema,
  RetryAdminRankingGenerationSchema,
} from '@personamarket/contracts';
import { ApiError, authQuery } from '@/lib/auth-api';
import { rankingTaskApi } from '@/lib/ranking-task-api';
import { operationalTasksApi } from '@/lib/operational-tasks-api';
import {
  taskCommandHash,
  taskDraftKey,
  restoreTaskDraft,
  taskDraftAfterFailure,
  type ExactTaskCommand,
  type ExactTaskDraft,
  type ExactTaskTarget,
} from './task-command-state';

export function useTaskCommand(
  accountId: string,
  target: ExactTaskTarget,
  refresh: () => void,
  onSettled: () => void,
  onPendingChange: (value: boolean) => void,
) {
  const client = useQueryClient(),
    key = useMemo(() => taskDraftKey(accountId, target), [accountId, target.kind, target.id]);
  const [draft, setDraft] = useState(() =>
      restoreTaskDraft(client.getQueryData<ExactTaskDraft>(key)),
    ),
    [preparing, setPreparing] = useState(false),
    [prepareError, setPrepareError] = useState<string>();
  const alive = useRef(true),
    sending = useRef(false),
    readers = useRef(new Set<AbortController>()),
    preparation = useRef<string | undefined>(undefined);
  function sameAccount() {
    const value = AuthContextResponseSchema.safeParse(client.getQueryData(authQuery.queryKey));
    return (
      value.success &&
      value.data.data.account?.id === accountId &&
      value.data.data.account.role === 'admin' &&
      value.data.data.assurance === 'authenticated'
    );
  }
  function preserve(value: ExactTaskDraft) {
    if (!sameAccount()) return;
    client.setQueryData(key, value);
    if (alive.current) setDraft(value);
  }
  useEffect(() => {
    client.setQueryDefaults(key, { gcTime: Infinity });
    const previous = client.getQueryData<ExactTaskDraft>(key),
      restored = restoreTaskDraft(previous);
    if (restored && restored !== previous) client.setQueryData(key, restored);
    alive.current = true;
    const pending = readers.current;
    return () => {
      alive.current = false;
      preparation.current = undefined;
      for (const reader of pending) reader.abort();
      pending.clear();
      const previous = client.getQueryData<ExactTaskDraft>(key),
        restored = restoreTaskDraft(previous);
      if (restored && restored !== previous) client.setQueryData(key, restored);
      onPendingChange(false);
    };
  }, [client, key, onPendingChange]);
  function retained(command: ExactTaskCommand) {
    const value = client.getQueryData<ExactTaskDraft>(key);
    return value?.command?.key === command.key && value.command.hash === command.hash
      ? value
      : undefined;
  }
  function refreshLists() {
    void client.invalidateQueries({ queryKey: ['private', 'admin-tasks', accountId] });
    void client.invalidateQueries({ queryKey: ['private', 'admin-task-retries', accountId] });
  }
  const write = useMutation({
    mutationKey: ['private', 'admin-task-command', accountId, target.kind, target.id],
    mutationFn: (command: ExactTaskCommand) =>
      command.target.kind === 'ranking'
        ? rankingTaskApi
            .retry(
              accountId,
              command.target.id,
              RetryAdminRankingGenerationSchema.parse(command.input),
              command.key,
            )
            .then(() => undefined)
        : operationalTasksApi
            .handle(
              accountId,
              { kind: command.target.kind, id: command.target.id },
              OperationalTaskCommandSchema.parse(command.input),
              command.key,
            )
            .then(() => undefined),
    retry: false,
    onSuccess: (_result, command) => {
      if (!sameAccount()) return;
      const saved = retained(command);
      if (!saved) return;
      preserve({
        ...saved,
        command: { ...command, outcome: 'accepted' },
        message: '原请求已受理；受理回执不代表业务完成，请核对当前状态',
      });
      refreshLists();
      if (alive.current) {
        onSettled();
        refresh();
      }
    },
    onError: (error, command) => {
      if (!sameAccount()) return;
      const saved = retained(command);
      if (!saved) return;
      const next = taskDraftAfterFailure(
        saved,
        command,
        error instanceof ApiError ? error.code : undefined,
      );
      if (next === saved) return;
      preserve(next);
      if (alive.current) {
        onSettled();
        refresh();
      }
    },
    onSettled: () => {
      sending.current = false;
      if (alive.current) onPendingChange(false);
    },
  });
  const receipt = useMutation({
    mutationKey: ['private', 'admin-task-receipt', accountId, target.kind, target.id],
    mutationFn: async (command: ExactTaskCommand) => {
      const reader = new AbortController();
      readers.current.add(reader);
      try {
        if (command.target.kind === 'ranking') {
          const result = await rankingTaskApi.receipt(
            accountId,
            command.target.id,
            command.key,
            command.hash,
            reader.signal,
          );
          return { recorded: result.data.recorded, recordedAt: result.data.recordedAt };
        }
        const result = await operationalTasksApi.receipt(
          accountId,
          { kind: command.target.kind, id: command.target.id },
          command.key,
          command.hash,
          reader.signal,
        );
        return {
          recorded: result.data.recorded,
          recordedAt: result.data.record?.recordedAt ?? null,
        };
      } finally {
        readers.current.delete(reader);
      }
    },
    retry: false,
    onSuccess: (result, command) => {
      if (!alive.current || !sameAccount()) return;
      const saved = retained(command);
      if (!saved) return;
      if (result.recorded) write.reset();
      preserve({
        ...saved,
        receipt: result,
        command: { ...command, outcome: result.recorded ? 'accepted' : command.outcome },
        message: result.recorded
          ? '原请求回执已核实为已受理，当前业务状态需单独核对'
          : '未找到原请求回执，迟到请求仍可能完成；只可明确重试原对象与原载荷',
      });
      refresh();
      refreshLists();
    },
    onError: (_error, command) => {
      if (!alive.current || !sameAccount()) return;
      const saved = retained(command);
      if (saved)
        preserve({
          ...saved,
          receipt: undefined,
          message: '原请求暂时无法核对，原对象、载荷和标识仍保留，可稍后继续只读核对',
        });
    },
  });
  const busy = preparing || write.isPending || receipt.isPending;
  function send(command: ExactTaskCommand) {
    if (sending.current || write.isPending || receipt.isPending || !alive.current || !sameAccount())
      return;
    sending.current = true;
    onPendingChange(true);
    receipt.reset();
    preserve({ reason: command.input.reason, command });
    write.mutate(command);
  }
  async function start(input: ExactTaskCommand['input']) {
    if (busy || sending.current || !sameAccount()) return;
    const token = crypto.randomUUID();
    preparation.current = token;
    setPreparing(true);
    setPrepareError(undefined);
    onPendingChange(true);
    try {
      const hash = await taskCommandHash(target, input);
      if (!alive.current || !sameAccount() || preparation.current !== token) return;
      send({
        accountId,
        target: { ...target },
        input: structuredClone(input),
        key: token,
        hash,
        outcome: 'sending',
      });
    } catch {
      if (alive.current && sameAccount()) {
        setPrepareError('原请求指纹未能生成，尚未提交；输入已保留，请重新确认');
        preserve({ ...(client.getQueryData<ExactTaskDraft>(key) ?? {}), reason: input.reason });
      }
    } finally {
      if (alive.current && preparation.current === token) {
        setPreparing(false);
        if (!sending.current) onPendingChange(false);
      }
    }
  }
  return {
    draft,
    write,
    receipt,
    busy,
    start,
    prepareError,
    setReason: (reason: string) =>
      preserve({ ...(client.getQueryData<ExactTaskDraft>(key) ?? {}), reason }),
    checkOriginal: () => {
      if (!busy && draft?.command && sameAccount()) receipt.mutate(draft.command);
    },
    repeat: () => {
      if (!busy && draft?.command) send(draft.command);
    },
  };
}
