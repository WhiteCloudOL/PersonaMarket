'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GuideWriteSchema,
  GuideActionSchema,
  type GuideWrite,
  type ManagedGuide,
  type GuideActionName,
} from '@personamarket/contracts';
import { guidesApi, guidesKey, type GuideCommand } from '@/lib/guides-api';
import { guideFields, guideStatuses } from './guide-labels';

type Draft = { snapshot: ManagedGuide; values: GuideWrite };
type Operation = { command: GuideCommand; before: ManagedGuide };
export function useGuideEditor(accountId: string, initial: ManagedGuide) {
  const client = useQueryClient();
  const key = useMemo(
    () => [...guidesKey(accountId), 'draft', initial.slug],
    [accountId, initial.slug],
  );
  const [preserved] = useState(() => client.getQueryData<Draft>(key));
  const [snapshot, setSnapshot] = useState(preserved?.snapshot ?? initial);
  const [candidate, setCandidate] = useState<ManagedGuide>();
  const [confirm, setConfirm] = useState<GuideActionName>();
  const [reading, setReading] = useState(false),
    [readError, setReadError] = useState<Error>();
  const [message, setMessage] = useState<string>();
  const commandKey = useRef<{ signature: string; key: string } | undefined>(undefined);
  const reader = useRef<AbortController | undefined>(undefined),
    alive = useRef(true);
  const form = useForm<GuideWrite>({
    resolver: zodResolver(GuideWriteSchema),
    defaultValues: preserved?.values ?? { ...guideFields(initial), reason: '' },
  });
  const [title, summary, bodyMarkdown, reason] = useWatch({
    control: form.control,
    name: ['title', 'summary', 'bodyMarkdown', 'reason'],
  });
  const values = useMemo(
    () => ({ title, summary, bodyMarkdown, reason }),
    [title, summary, bodyMarkdown, reason],
  );
  const changed = JSON.stringify(guideFields(values)) !== JSON.stringify(guideFields(snapshot));
  const dirty = changed || Boolean(reason);
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
    if (dirty) client.setQueryData(key, { snapshot, values } satisfies Draft);
    else client.removeQueries({ queryKey: key, exact: true });
  }, [client, key, snapshot, values, dirty]);
  const mutation = useMutation({
    mutationFn: ({ command }: Operation) => {
      const signature = JSON.stringify(command);
      const prepared =
        commandKey.current?.signature === signature
          ? commandKey.current
          : { signature, key: crypto.randomUUID() };
      commandKey.current = prepared;
      return guidesApi.mutate(accountId, command, prepared.key);
    },
    retry: false,
    onSuccess: (result, { command, before }) => {
      if (!alive.current) return;
      const next = result.data;
      setReadError(undefined);
      commandKey.current = undefined;
      setConfirm(undefined);
      client.setQueryData([...guidesKey(accountId), 'detail', next.slug], result);
      void client.invalidateQueries({ queryKey: [...guidesKey(accountId), 'list'] });
      void client.invalidateQueries({ queryKey: [...guidesKey(accountId), 'records', next.slug] });
      const expected = command.action === 'edit' ? command.input : before;
      if (JSON.stringify(guideFields(next)) !== JSON.stringify(guideFields(expected))) {
        setCandidate(next);
        client.setQueryData(key, { snapshot: before, values: form.getValues() } satisfies Draft);
        setMessage('服务器已有后续修订，当前输入已保留，请核对最新内容后继续');
        return;
      }
      // 撤回只处理当前公开稿，仍待保存的本地正文和标题继续保留
      const current = form.getValues();
      const retained = {
        ...(command.action === 'edit' ? guideFields(next) : guideFields(current)),
        reason: '',
      };
      setSnapshot(next);
      setCandidate(undefined);
      form.reset(retained);
      if (JSON.stringify(guideFields(retained)) !== JSON.stringify(guideFields(next)))
        client.setQueryData(key, { snapshot: next, values: retained } satisfies Draft);
      else client.removeQueries({ queryKey: key, exact: true });
      setMessage(
        command.action === 'edit'
          ? '编辑稿已保存，核对后可确认发布'
          : '操作结果已核对，当前指南' + guideStatuses[next.status],
      );
    },
  });
  async function readLatest() {
    reader.current?.abort();
    const controller = new AbortController();
    reader.current = controller;
    setReading(true);
    setReadError(undefined);
    try {
      const response = await guidesApi.read(accountId, snapshot.slug, controller.signal);
      if (alive.current && reader.current === controller) setCandidate(response.data);
    } catch (cause) {
      if (alive.current && !controller.signal.aborted)
        setReadError(cause instanceof Error ? cause : new Error('最新指南暂时无法读取'));
    } finally {
      if (alive.current && reader.current === controller) setReading(false);
    }
  }
  function adoptLatest() {
    if (!candidate) return;
    setSnapshot(candidate);
    setCandidate(undefined);
    commandKey.current = undefined;
    mutation.reset();
    setMessage(undefined);
  }
  async function prepareAction(action: GuideActionName) {
    if (await form.trigger('reason')) {
      mutation.reset();
      setConfirm(action);
    }
  }
  function submitAction() {
    if (!confirm) return;
    const parsed = GuideActionSchema.safeParse({
      reason: form.getValues('reason'),
      confirmed: true,
    });
    if (!parsed.success) {
      form.setError('reason', { message: parsed.error.issues[0]?.message ?? '请填写处理理由' });
      setConfirm(undefined);
      return;
    }
    setMessage(undefined);
    mutation.mutate({
      command: {
        action: confirm,
        slug: snapshot.slug,
        revision: snapshot.revision,
        input: parsed.data,
      },
      before: snapshot,
    });
  }
  function save(input: GuideWrite) {
    setMessage(undefined);
    mutation.mutate({
      command: { action: 'edit', slug: snapshot.slug, revision: snapshot.revision, input },
      before: snapshot,
    });
  }
  return {
    form,
    snapshot,
    candidate,
    confirm,
    setConfirm,
    reading,
    readError,
    message,
    values,
    changed,
    dirty,
    mutation,
    busy: reading || mutation.isPending,
    readLatest,
    adoptLatest,
    prepareAction,
    submitAction,
    save,
  };
}
