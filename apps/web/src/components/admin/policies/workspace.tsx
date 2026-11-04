'use client';
import Link from 'next/link';
import { useCallback, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query';
import { PolicySlugSchema } from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { authQuery } from '@/lib/auth-api';
import { useSettingsDirty } from '@/components/settings/settings-navigation';
import { useUnsavedDraft } from '@/components/personas/use-unsaved-draft';
import { FormNotice } from '@/components/auth/auth-fields';
import { policiesApi, policiesKey } from './api';
import { policyLabels } from './labels';
import { PolicyEditor } from './editor';

const retainedNavigation = (target: URL, current: URL) =>
  target.origin === current.origin && target.pathname.startsWith('/admin/settings/');
const serverDraftCount = () => 0;
export function PolicyWorkspace() {
  const params = useSearchParams();
  const parsed = PolicySlugSchema.safeParse(params.get('document') ?? 'terms');
  const slug = parsed.success ? parsed.data : 'terms';
  const client = useQueryClient();
  const auth = useQuery(authQuery);
  const account = auth.data?.data.account;
  const authorized = account?.role === 'admin' && auth.data?.data.assurance === 'authenticated';
  const accountId = authorized && account ? account.id : '';
  const subscribe = useCallback(
    (notify: () => void) => client.getQueryCache().subscribe(notify),
    [client],
  );
  const draftCount = useCallback(
    () => client.getQueryCache().findAll({ queryKey: [...policiesKey(accountId), 'draft'] }).length,
    [client, accountId],
  );
  const preservedDrafts = useSyncExternalStore(subscribe, draftCount, serverDraftCount);
  const pending = useIsMutating({ mutationKey: [...policiesKey(accountId), 'mutations'] }) > 0;
  useSettingsDirty(preservedDrafts > 0 || pending);
  useUnsavedDraft(
    preservedDrafts > 0 || pending,
    '还有未保存的规则输入或待核对操作，确定离开吗',
    retainedNavigation,
  );
  const query = useQuery({
    queryKey: [...policiesKey(accountId), 'detail', slug],
    queryFn: ({ signal }) => policiesApi.read(accountId, slug, signal),
    enabled: authorized,
    refetchOnMount: 'always',
    retry: false,
  });
  if (!authorized) return <FormNotice error="请使用有效管理员会话维护公共规则" />;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <nav aria-label="选择公共规则" className="flex min-w-0 flex-wrap gap-2">
        {PolicySlugSchema.options.map((value) => {
          const next = new URLSearchParams(params.toString());
          next.set('document', value);
          for (const name of ['policyPage', 'policyStatus', 'policyRecordPage']) next.delete(name);
          return (
            <Link
              key={value}
              href={'/admin/settings/policies?' + next.toString()}
              scroll={false}
              aria-current={value === slug ? 'page' : undefined}
              className={buttonVariants({
                variant: value === slug ? 'secondary' : 'outline',
                className: 'h-auto min-h-11 max-w-full whitespace-normal py-2',
              })}
              onNavigate={(event) => {
                if (pending) event.preventDefault();
              }}
            >
              {policyLabels[value]}
            </Link>
          );
        })}
      </nav>
      {preservedDrafts > 1 && (
        <p className="text-sm text-muted-foreground">
          当前账号有 {preservedDrafts} 份规则保留了未提交输入或待核对操作
        </p>
      )}
      {query.isError && (
        <div className="flex flex-col items-start gap-3">
          <FormNotice error={query.error} />
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            重新读取公共规则
          </Button>
        </div>
      )}
      {!query.data && query.isPending && (
        <div role="status">
          <span className="sr-only">正在读取公共规则…</span>
          <Skeleton className="h-64 w-full" aria-hidden="true" />
        </div>
      )}
      {query.data && (
        <PolicyEditor
          key={accountId + ':' + slug}
          accountId={accountId}
          initial={query.data.data}
        />
      )}
    </div>
  );
}
