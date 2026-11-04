'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type AdminReportAction, type AdminReport } from '@personamarket/contracts';
import type { z } from 'zod';
import { reportsApi, reportsKey } from '@/lib/reports-api';
import { reportActionFormSchema, rebaseReportResolution } from '@/lib/report-action-form';

type Draft = { snapshot: AdminReport; values: z.input<typeof reportActionFormSchema> };
const initialValues = (row: AdminReport): AdminReportAction => ({
  action: row.status === 'pending' ? 'accept' : row.status === 'processing' ? 'resolve' : 'note',
  message: '',
  privateNote: '',
  selfReviewConfirmed: false,
  confirmed: true,
});
export function useReportAction(accountId: string, initial: AdminReport) {
  const client = useQueryClient();
  const draftKey = useMemo(
    () => [...reportsKey(accountId, true), 'draft', initial.id],
    [accountId, initial.id],
  );
  const [preserved] = useState(() => client.getQueryData<Draft>(draftKey));
  const [snapshot, setSnapshot] = useState(preserved?.snapshot ?? initial);
  const [candidate, setCandidate] = useState<AdminReport>();
  const [confirmation, setConfirmation] = useState<AdminReportAction>();
  const [message, setMessage] = useState<string>();
  const [reading, setReading] = useState(false),
    [readError, setReadError] = useState<Error>();
  const alive = useRef(true),
    reader = useRef<AbortController | undefined>(undefined);
  const nonce = useRef<{ signature: string; key: string } | undefined>(undefined);
  const form = useForm<z.input<typeof reportActionFormSchema>, unknown, AdminReportAction>({
    resolver: zodResolver(reportActionFormSchema),
    defaultValues: preserved?.values ?? initialValues(initial),
  });
  const watched = useWatch({ control: form.control });
  const dirty = Boolean(
    watched.message || watched.privateNote || watched.selfReviewConfirmed || watched.resolution,
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      reader.current?.abort();
    };
  }, []);
  useEffect(() => {
    client.setQueryDefaults(draftKey, { gcTime: Infinity });
  }, [client, draftKey]);
  useEffect(() => {
    if (dirty)
      client.setQueryData(draftKey, { snapshot, values: form.getValues() } satisfies Draft);
    else client.removeQueries({ queryKey: draftKey, exact: true });
  }, [client, draftKey, snapshot, watched, dirty, form]);
  const mutation = useMutation({
    mutationFn: (input: AdminReportAction) => {
      const signature = JSON.stringify({ id: snapshot.id, revision: snapshot.revision, input });
      if (!nonce.current || nonce.current.signature !== signature)
        nonce.current = { signature, key: crypto.randomUUID() };
      return reportsApi.act(accountId, snapshot.id, snapshot.revision, input, nonce.current.key);
    },
    retry: false,
    onSuccess: (result) => {
      if (!alive.current) return;
      setConfirmation(undefined);
      nonce.current = undefined;
      client.setQueryData([...reportsKey(accountId, true), 'detail', snapshot.id], result);
      void client.invalidateQueries({ queryKey: [...reportsKey(accountId, true), 'list'] });
      void client.invalidateQueries({ queryKey: ['private', 'review-indicators', accountId] });
      void client.invalidateQueries({
        queryKey: [...reportsKey(accountId, true), 'records', snapshot.id],
      });
      if (result.data.revision !== snapshot.revision + 1) {
        setCandidate(result.data);
        setMessage('操作已处理，服务器还有后续修订，当前输入已保留，请核对最新记录');
        return;
      }
      setSnapshot(result.data);
      setCandidate(undefined);
      form.reset(initialValues(result.data));
      client.removeQueries({ queryKey: draftKey, exact: true });
      setMessage('处理记录已保存');
    },
    onError: () => {
      if (alive.current) setConfirmation(undefined);
    },
  });
  async function readLatest() {
    reader.current?.abort();
    const controller = new AbortController();
    reader.current = controller;
    setReading(true);
    setReadError(undefined);
    try {
      const next = await reportsApi.admin(accountId, snapshot.id, controller.signal);
      if (alive.current && reader.current === controller) setCandidate(next.data);
    } catch (cause) {
      if (alive.current && !controller.signal.aborted)
        setReadError(cause instanceof Error ? cause : new Error('最新举报状态暂时无法读取'));
    } finally {
      if (alive.current && reader.current === controller) setReading(false);
    }
  }
  function adopt() {
    if (!candidate) return;
    form.setValue('resolution', rebaseReportResolution(form.getValues('resolution'), candidate), {
      shouldDirty: true,
    });
    setSnapshot(candidate);
    setCandidate(undefined);
    nonce.current = undefined;
    mutation.reset();
    setMessage('已采用最新修订，处理说明和内部备注仍保留，请重新核对操作');
  }
  return {
    form,
    snapshot,
    candidate,
    confirmation,
    setConfirmation,
    message,
    reading,
    readError,
    dirty,
    mutation,
    readLatest,
    adopt,
  };
}
