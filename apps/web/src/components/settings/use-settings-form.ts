'use client';
import { useEffect, useRef, useState } from 'react';
import {
  useForm,
  useWatch,
  type DefaultValues,
  type FieldValues,
  type Resolver,
} from 'react-hook-form';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { type AuthContextResponse } from '@personamarket/contracts';
import { ApiError, authQuery } from '@/lib/auth-api';
import {
  isSettingsConflict,
  mergeSettings,
  sameSettings,
  settingsConflictMessage,
} from '@/lib/settings-save';
import { useSettingsDirty } from './settings-navigation';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';

type Command<T, R> = { input: T; expected: R; key: string };
type Draft<T, R> = { snapshot: R; values: T; original?: Command<T, R> | undefined };
const withinSettings = (target: URL, current: URL) =>
  target.origin === current.origin && target.pathname.startsWith('/admin/settings/');

export function useSettingsForm<T extends FieldValues, R>({
  accountId,
  queryKey,
  initial,
  resolver,
  valuesFor,
  read,
  write,
  saved,
  onSaved,
}: {
  accountId: string;
  queryKey: QueryKey;
  initial: R;
  resolver: Resolver<T>;
  valuesFor: (result: R) => T;
  read: (signal: AbortSignal) => Promise<R>;
  write: (input: T, snapshot: R, key: string) => Promise<R>;
  saved: string;
  onSaved?: ((result: R) => void) | undefined;
}) {
  const client = useQueryClient();
  const [draftKey] = useState(() => [...queryKey, 'draft']);
  const [preserved] = useState(() => client.getQueryData<Draft<T, R>>(draftKey));
  const [snapshot, setSnapshot] = useState(preserved?.snapshot ?? initial);
  const [original, setOriginal] = useState(preserved?.original);
  const [message, setMessage] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const form = useForm<T>({
    resolver,
    defaultValues: (preserved?.values ?? valuesFor(snapshot)) as DefaultValues<T>,
  });
  const signature = useWatch({ control: form.control, compute: (input) => JSON.stringify(input) });
  const dirty = !sameSettings(form.getValues(), valuesFor(snapshot));
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function activeAccount() {
    const session = client.getQueryData<AuthContextResponse>(authQuery.queryKey)?.data;
    return (
      session?.account?.id === accountId &&
      session.account.role === 'admin' &&
      session.assurance === 'authenticated'
    );
  }

  const mutation = useMutation({
    retry: false,
    mutationFn: async (input: T) => {
      const base = snapshot;
      let pending = original;
      const next = input;
      const finish = (result: R, edited = valuesFor(result), conflict = false) => ({
        result,
        edited,
        conflict,
      });
      const send = async (command: Command<T, R>) => {
        pending = command;
        try {
          const result = await write(command.input, command.expected, command.key);
          pending = undefined;
          return result;
        } catch (error) {
          if (isSettingsConflict(error)) pending = undefined;
          throw error;
        }
      };
      try {
        if (original) {
          try {
            const result = await send(original);
            if (sameSettings(next, original.input)) {
              const merged = mergeSettings(valuesFor(original.expected), next, valuesFor(result));
              return finish(
                result,
                merged.conflict ? merged.data : valuesFor(result),
                merged.conflict,
              );
            }
            const merged = mergeSettings(original.input, next, valuesFor(result));
            return finish(result, merged.data, merged.conflict);
          } catch (error) {
            if (!isSettingsConflict(error)) throw error;
          }
        }
        if (sameSettings(next, valuesFor(base))) return finish(base);
        try {
          return finish(await send({ input: next, expected: base, key: crypto.randomUUID() }));
        } catch (error) {
          if (!isSettingsConflict(error)) throw error;
          const latest = await read(AbortSignal.timeout(10000));
          const merged = mergeSettings(valuesFor(base), next, valuesFor(latest));
          if (merged.conflict) return finish(latest, merged.data, true);
          if (sameSettings(merged.data, valuesFor(latest))) return finish(latest);
          return finish(
            await send({ input: merged.data, expected: latest, key: crypto.randomUUID() }),
          );
        }
      } catch (error) {
        // An ambiguous write can only be retried with its original payload and key.
        const uncertain =
          pending &&
          (pending === original ||
            !(error instanceof ApiError) ||
            ['INTERNAL_ERROR', 'SERVICE_UNAVAILABLE', 'INVALID_RESPONSE'].includes(error.code));
        const retained = uncertain ? pending : undefined;
        if (activeAccount()) {
          const values = form.getValues();
          const draft = { snapshot: base, values, original: retained };
          client.setQueryData(draftKey, draft);
          if (mounted.current) {
            setOriginal(retained);
          }
        }
        if (
          uncertain &&
          (!(error instanceof ApiError) ||
            ['INTERNAL_ERROR', 'SERVICE_UNAVAILABLE', 'INVALID_RESPONSE'].includes(error.code))
        )
          throw new Error('暂时无法确认保存结果，请再次点击保存。', { cause: error });
        if (isSettingsConflict(error))
          throw new Error('设置正在被修改，请再次点击保存。', { cause: error });
        throw error;
      }
    },
    onMutate: () => setMessage(undefined),
    onSuccess: ({ result, edited, conflict }) => {
      if (!activeAccount()) return;
      client.setQueryData(queryKey, result);
      void client.invalidateQueries({ queryKey: [...queryKey, 'records'] });
      const hasEdits = !sameSettings(edited, valuesFor(result));
      if (hasEdits) client.setQueryData(draftKey, { snapshot: result, values: edited });
      else client.removeQueries({ queryKey: draftKey, exact: true });
      if (!mounted.current) return;
      setSnapshot(result);
      setOriginal(undefined);
      form.reset(edited);
      setConflict(conflict);
      setMessage(
        conflict
          ? undefined
          : hasEdits
            ? '先前的保存已确认，新的修改已保留。再次点击保存即可提交。'
            : saved,
      );
      if (!conflict) onSaved?.(result);
    },
  });
  function save(input: T) {
    if (mutation.isPending) return;
    setConflict(false);
    mutation.mutate(input);
  }

  useEffect(() => {
    client.setQueryDefaults(draftKey, { gcTime: Infinity });
  }, [client, draftKey]);
  useEffect(() => {
    const session = client.getQueryData<AuthContextResponse>(authQuery.queryKey)?.data;
    if (
      session?.account?.id !== accountId ||
      session.account.role !== 'admin' ||
      session.assurance !== 'authenticated'
    )
      return;
    if (dirty || original)
      client.setQueryData(draftKey, { snapshot, values: form.getValues(), original });
    else client.removeQueries({ queryKey: draftKey, exact: true });
  }, [accountId, client, dirty, draftKey, form, original, signature, snapshot]);

  const unsaved = dirty || mutation.isPending || Boolean(original);
  useSettingsDirty(unsaved);
  useUnsavedDraft(unsaved, '还有未保存的设置，确定离开吗', withinSettings);
  return {
    form,
    snapshot,
    dirty,
    busy: mutation.isPending,
    save,
    message,
    canSave: dirty || Boolean(original),
    error: mutation.error ?? (conflict ? settingsConflictMessage : undefined),
  };
}
