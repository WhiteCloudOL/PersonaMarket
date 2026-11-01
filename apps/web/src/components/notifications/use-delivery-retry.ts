'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AuthContextResponseSchema,
  type NotificationDeliveryDetail,
} from '@personamarket/contracts';
import { ApiError, authQuery } from '@/lib/auth-api';
import { notificationsApi, notificationsKey } from '@/lib/notifications-api';
import {
  deliveryResultUncertain,
  canBeginDeliveryRound,
  type DeliveryCommand,
  type DeliveryDraft,
} from './delivery-state';

export function useDeliveryRetry(
  accountId: string,
  id: string,
  onResult: () => void,
  onPendingChange: (pending: boolean) => void,
) {
  const client = useQueryClient();
  const draftKey = useMemo(
    () => [...notificationsKey(accountId), 'delivery-retry-draft', id],
    [accountId, id],
  );
  const [draft, setDraft] = useState(() => client.getQueryData<DeliveryDraft>(draftKey));
  const alive = useRef(true),
    sending = useRef(false);
  const readers = useRef(new Set<AbortController>());
  const query = useQuery({
    queryKey: [...notificationsKey(accountId), 'delivery', id],
    queryFn: ({ signal }) => notificationsApi.delivery(accountId, id, signal),
    retry: false,
    staleTime: 0,
  });
  const current = query.isError || query.isFetching ? undefined : query.data?.data;
  function sameAccount() {
    const parsed = AuthContextResponseSchema.safeParse(client.getQueryData(authQuery.queryKey));
    return (
      parsed.success &&
      parsed.data.data.account?.id === accountId &&
      parsed.data.data.account.role === 'admin' &&
      parsed.data.data.assurance === 'authenticated'
    );
  }
  function preserve(value: DeliveryDraft | undefined) {
    if (!sameAccount()) return;
    if (value) client.setQueryData(draftKey, value);
    else client.removeQueries({ queryKey: draftKey, exact: true });
    if (alive.current) setDraft(value);
  }
  useEffect(() => {
    client.setQueryDefaults(draftKey, { gcTime: Infinity });
    alive.current = true;
    const pendingReaders = readers.current;
    return () => {
      alive.current = false;
      for (const reader of pendingReaders) reader.abort();
      pendingReaders.clear();
    };
  }, [client, draftKey]);
  function retained(command: DeliveryCommand) {
    const latest = client.getQueryData<DeliveryDraft>(draftKey);
    return latest?.command.key === command.key ? latest : undefined;
  }
  function refreshLists() {
    void client.invalidateQueries({ queryKey: [...notificationsKey(accountId), 'history'] });
    void client.invalidateQueries({ queryKey: [...notificationsKey(accountId), 'failures'] });
    void client.invalidateQueries({ queryKey: ['private', 'admin-tasks', accountId] });
  }
  const write = useMutation({
    mutationFn: async (command: DeliveryCommand): Promise<void> => {
      if (command.scope === 'notice')
        await notificationsApi.retry(
          accountId,
          command.id,
          command.input.expectedRevision,
          command.key,
        );
      else
        await notificationsApi.retryFailure(
          accountId,
          command.id,
          command.input.expectedRevision,
          command.key,
        );
    },
    retry: false,
    onSuccess: (_result, command) => {
      if (!sameAccount()) return;
      const saved = retained(command);
      if (!saved) return;
      preserve({
        ...saved,
        command: { ...command, accepted: true, uncertain: false },
        message: '重投请求已受理，请核对当前业务状态；受理不代表已送达',
      });
      refreshLists();
      if (alive.current) {
        onResult();
        void query.refetch();
      }
    },
    onError: (error, command) => {
      if (!sameAccount()) return;
      const saved = retained(command);
      if (!saved) return;
      const uncertain = deliveryResultUncertain(
        error instanceof ApiError ? error.code : undefined,
        command.uncertain,
      );
      preserve({
        ...saved,
        command: { ...command, uncertain },
        receipt: undefined,
        message: uncertain
          ? '重投结果尚不确定，原请求已保留，请先核对原请求，系统不会自动重新投递'
          : '本次操作没有完成，原请求已保留，请核对后明确重试',
      });
      if (alive.current) {
        onResult();
        // 写入应答未知时，旧失败/成功快照也不再代表当前事实；这里只刷新只读详情。
        void query.refetch();
      }
    },
    onSettled: () => {
      sending.current = false;
      onPendingChange(false);
    },
  });
  const receipt = useMutation({
    mutationFn: async (command: DeliveryCommand) => {
      const controller = new AbortController();
      readers.current.add(controller);
      try {
        return await notificationsApi.retryReceipt(
          accountId,
          command.id,
          command.input.expectedRevision,
          command.key,
          controller.signal,
        );
      } finally {
        readers.current.delete(controller);
      }
    },
    retry: false,
    onSuccess: (result, command) => {
      if (!alive.current || !sameAccount()) return;
      const saved = retained(command);
      if (!saved) return;
      if (result.data.recorded) write.reset();
      preserve({
        ...saved,
        receipt: result.data,
        command: {
          ...saved.command,
          accepted: result.data.recorded || saved.command.accepted,
          uncertain: result.data.recorded ? false : saved.command.uncertain,
        },
        message: result.data.recorded
          ? '原请求曾被受理；以下当前状态可能属于后续轮次，不代表该原请求的历史事件'
          : '本次未找到原请求记录，迟到请求仍可能完成；只能明确重试原标识与原载荷',
      });
      void query.refetch();
      refreshLists();
    },
    onError: (_error, command) => {
      if (!alive.current || !sameAccount()) return;
      const saved = retained(command);
      if (saved)
        preserve({
          ...saved,
          receipt: undefined,
          message: '原请求暂时无法核对，原标识与载荷仍保留，请稍后明确核对',
        });
    },
  });
  const busy = write.isPending || receipt.isPending;
  function send(command: DeliveryCommand) {
    if (sending.current || busy || !sameAccount()) return;
    sending.current = true;
    onPendingChange(true);
    receipt.reset();
    preserve({ command });
    write.mutate(command);
  }
  function submitNew(basis: NotificationDeliveryDetail) {
    if (
      !current ||
      current.id !== basis.id ||
      current.revision !== basis.revision ||
      current.eventId !== basis.eventId ||
      current.status !== basis.status ||
      current.scope !== basis.scope ||
      !canBeginDeliveryRound(current, draft)
    )
      return;
    send({
      accountId,
      id,
      scope: basis.scope,
      input: { expectedRevision: basis.revision, confirmed: true },
      key: crypto.randomUUID(),
      uncertain: false,
      accepted: false,
    });
  }
  return {
    query,
    current,
    draft,
    write,
    receipt,
    busy,
    submitNew,
    repeat: () => {
      if (draft?.command && current?.retryAllowed) send(draft.command);
    },
    checkOriginal: () => {
      if (draft?.command && !busy) receipt.mutate(draft.command);
    },
    canStart: Boolean(current && canBeginDeliveryRound(current, draft)),
  };
}
