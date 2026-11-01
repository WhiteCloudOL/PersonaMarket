'use client';
import Link from 'next/link';
import { createContext, use, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HeartIcon, BookmarkIcon } from 'lucide-react';
import type { z } from 'zod';
import type { InteractionCounts, OwnInteractionsResponseSchema } from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Toggle } from '@personamarket/ui/components/toggle';
import { authQuery } from '@/lib/auth-api';
import { interactionKey, favoritesKey, interactionsApi } from '@/lib/interactions-api';
import { FormNotice } from '../auth/auth-fields';

type Batch = z.infer<typeof OwnInteractionsResponseSchema>;
type InteractionContextValue = {
  accountId: string | undefined;
  access: 'guest' | 'loading' | 'ready' | 'error' | 'unverified' | 'mfa';
  data: Batch | undefined;
  retry: () => void;
};
const InteractionContext = createContext<InteractionContextValue | null>(null);
const subscribeToHydration = () => () => {};

/** 内容仍由RSC渲染；整组卡片只批量读取一次当前账号的私有状态 */
export function InteractionProvider({ ids, children }: { ids: string[]; children: ReactNode }) {
  // Header可能先填充会话缓存；首次水合必须保持服务端的加载状态，避免替换整组公开内容
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const auth = useQuery(authQuery);
  const account = auth.data?.data.account;
  const encoded = [...new Set(ids)].sort().join(',');
  const authenticated = auth.data?.data.assurance === 'authenticated';
  const query = useQuery({
    queryKey: [...interactionKey(account?.id ?? 'guest'), encoded],
    queryFn: ({ signal }) => interactionsApi.states(encoded, signal),
    enabled: Boolean(hydrated && account && authenticated && encoded),
    retry: false,
  });
  const access =
    !hydrated || auth.isPending
      ? 'loading'
      : auth.isError
        ? 'error'
        : !account
          ? 'guest'
          : !authenticated
            ? 'mfa'
            : !account.emailVerified
              ? 'unverified'
              : query.isError
                ? 'error'
                : query.isPending
                  ? 'loading'
                  : 'ready';
  return (
    <InteractionContext
      value={{
        accountId: hydrated ? account?.id : undefined,
        access,
        data: hydrated ? query.data : undefined,
        retry: () => {
          void (auth.isError ? auth.refetch() : query.refetch());
        },
      }}
    >
      {children}
    </InteractionContext>
  );
}

export function InteractionControls({
  personaId,
  counts,
}: {
  personaId: string;
  counts: InteractionCounts;
}) {
  const context = use(InteractionContext);
  if (!context) throw new Error('INTERACTION_PROVIDER_MISSING');
  const client = useQueryClient();
  const router = useRouter();
  const state = context.data?.data.find((row) => row.personaId === personaId);
  const actual = state?.counts ?? counts;
  const mutation = useMutation({
    mutationFn: ({ kind, enabled }: { kind: 'like' | 'favorite'; enabled: boolean }) => {
      if (!context.accountId) throw new Error('请登录后继续');
      return interactionsApi.set(context.accountId, personaId, kind, enabled);
    },
    onSuccess: (result) => {
      // 防止换号后，迟到的旧账号响应重新填入已清理的私有缓存
      if (
        client.getQueryData<Awaited<ReturnType<typeof authQuery.queryFn>>>(authQuery.queryKey)?.data
          .account?.id !== context.accountId
      )
        return;
      client.setQueriesData<Batch>(
        { queryKey: interactionKey(context.accountId ?? '') },
        (previous) =>
          previous
            ? {
                ...previous,
                settings: result.settings,
                data: previous.data.flatMap((row) =>
                  row.personaId !== personaId
                    ? [row]
                    : result.data.available
                      ? [
                          {
                            personaId,
                            liked: result.data.liked,
                            favorited: result.data.favorited,
                            counts: result.data.counts,
                          },
                        ]
                      : [],
                ),
              }
            : previous,
      );
      void client.invalidateQueries({ queryKey: favoritesKey(context.accountId ?? '') });
      router.refresh();
    },
    retry: false,
  });
  const kinds = [
    {
      kind: 'like',
      label: '点赞',
      count: actual.likes,
      active: state?.liked ?? false,
      Icon: HeartIcon,
    },
    {
      kind: 'favorite',
      label: '收藏',
      count: actual.favorites,
      active: state?.favorited ?? false,
      Icon: BookmarkIcon,
    },
  ] as const;
  return (
    <div className="@container/interaction flex min-w-0 flex-col gap-2" aria-label="作品互动">
      <div className="flex min-w-0 flex-col gap-2 @min-[16rem]/interaction:flex-row">
        {kinds.map(({ kind, label, count, active, Icon }) =>
          context.access === 'guest' ? (
            <Link
              key={kind}
              href="/login"
              className={buttonVariants({
                variant: 'outline',
                className: 'h-auto min-h-11 min-w-11 flex-1 whitespace-normal',
              })}
              aria-label={'登录后' + label}
              title={'当前' + label + '总数 ' + count}
            >
              <Icon aria-hidden data-icon="inline-start" />
              {label} {count.toLocaleString('zh-CN')}
            </Link>
          ) : (
            <Toggle
              key={kind}
              variant="outline"
              className="h-auto min-h-11 min-w-11 flex-1 gap-2 whitespace-normal px-3 py-2"
              pressed={active}
              aria-label={(active ? '取消' : '') + label}
              title={'当前' + label + '总数 ' + count}
              disabled={
                context.access !== 'ready' ||
                !state ||
                mutation.isPending ||
                (!active &&
                  !(kind === 'like'
                    ? context.data?.settings.likesEnabled
                    : context.data?.settings.favoritesEnabled))
              }
              onPressedChange={(enabled) => mutation.mutate({ kind, enabled })}
            >
              <Icon aria-hidden data-icon="inline-start" fill={active ? 'currentColor' : 'none'} />
              {label} {count.toLocaleString('zh-CN')}
            </Toggle>
          ),
        )}
      </div>
      {context.access === 'loading' && (
        <p className="text-xs text-muted-foreground" role="status">
          正在读取互动状态…
        </p>
      )}
      {context.access === 'unverified' && (
        <Link href="/account" className="flex min-h-11 items-center text-sm text-primary underline">
          验证邮箱后可点赞收藏
        </Link>
      )}
      {context.access === 'mfa' && (
        <Link href="/mfa" className="flex min-h-11 items-center text-sm text-primary underline">
          完成登录验证后继续
        </Link>
      )}
      {context.access === 'error' && (
        <Button variant="ghost" onClick={context.retry}>
          重试互动状态
        </Button>
      )}
      {context.access === 'ready' && !state && (
        <Button variant="ghost" onClick={() => router.refresh()}>
          作品状态已变化，刷新后继续
        </Button>
      )}
      {context.access === 'ready' &&
        context.data &&
        (!context.data.settings.likesEnabled || !context.data.settings.favoritesEnabled) && (
          <p className="text-xs text-muted-foreground">部分互动暂未开放，已有记录仍可取消</p>
        )}
      <FormNotice error={mutation.error} />
      {mutation.isSuccess && (
        <p className="text-xs text-muted-foreground" role="status">
          {mutation.variables.enabled ? '已' : '已取消'}
          {mutation.variables.kind === 'like' ? '点赞' : '收藏'}
        </p>
      )}
    </div>
  );
}
