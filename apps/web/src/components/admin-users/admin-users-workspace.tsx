'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AdminUsersQuerySchema,
  IdSchema,
  type AdminUserDetailSchema,
  type AuthContextResponse,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@personamarket/ui/components/card';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { authQuery } from '@/lib/auth-api';
import { adminUsersApi, adminUsersKey } from '@/lib/admin-users-api';
import { PageIntro } from '../page-layout';
import { FormNotice } from '../auth/auth-fields';
import { useAuthRefresh } from '../auth/use-auth-change';
import { AdminUserFilters } from './admin-user-filters';
import { AdminUserDetail } from './admin-user-detail';
import { roleLabel, statusLabel } from './admin-user-fields';
import { AdminUserDraftProvider, useAdminUserDrafts } from './admin-user-drafts';

const subscribe = () => () => {};
function AuthorizedUsers({ accountId }: { accountId: string }) {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const client = useQueryClient();
  const refreshAuth = useAuthRefresh();
  const drafts = useAdminUserDrafts();
  const [remembered, setRemembered] = useState<string>(
    () => drafts.last(accountId)?.snapshot.id ?? '',
  );
  const [dirty, setDirty] = useState(() => Boolean(drafts.last(accountId)));
  const parsed = AdminUsersQuerySchema.safeParse({
    q: search.get('q') ?? '',
    role: search.get('role') ?? 'all',
    status: search.get('status') ?? 'all',
    deactivation: search.get('deactivation') ?? 'all',
    sort: search.get('sort') ?? 'newest',
    page: search.get('page') ?? 1,
    pageSize: 20,
  });
  const input = parsed.success ? parsed.data : undefined;
  const selected = IdSchema.safeParse(search.get('userId'));
  if (selected.success && remembered !== selected.data) setRemembered(selected.data);
  const query = useQuery({
    queryKey: [...adminUsersKey(accountId), 'list', input ?? search.toString()],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('筛选条件无效，请核对搜索、角色、状态或页码');
      return adminUsersApi.list(accountId, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  function update(values: Record<string, string | undefined>, replace = false) {
    const next = new URLSearchParams(search);
    for (const [name, value] of Object.entries(values)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    const url = pathname + (next.size ? '?' + next : '');
    if (replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  }
  function manage(id: string) {
    if (
      dirty &&
      remembered !== id &&
      !window.confirm('上一位用户还有未提交的操作，确定放弃并查看其他用户吗')
    )
      return;
    update({
      userId: id,
      applicationPage: undefined,
      userView: undefined,
      publicPage: undefined,
      recordPage: undefined,
      recordKind: undefined,
    });
  }
  async function changed(value: z.infer<typeof AdminUserDetailSchema>) {
    const current = client.getQueryData<AuthContextResponse>(authQuery.queryKey)?.data;
    if (
      current?.assurance !== 'authenticated' ||
      current.account?.id !== accountId ||
      current.account.role !== 'admin'
    )
      return;
    client.setQueryData([...adminUsersKey(accountId), 'detail', value.id], { data: value });
    await client.invalidateQueries({ queryKey: [...adminUsersKey(accountId), 'list'] });
    if (value.id === accountId) await refreshAuth('logout');
  }
  const defaults = input ?? AdminUsersQuerySchema.parse({});
  const totalPages = query.data
    ? Math.min(2500, Math.max(1, Math.ceil(query.data.meta.total / 20)))
    : 1;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageIntro eyebrow="管理后台 · 账号与权限" title="用户管理" />
      <Card>
        <CardHeader>
          <CardTitle>查找用户</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminUserFilters
            key={JSON.stringify([
              defaults.q,
              defaults.role,
              defaults.status,
              defaults.deactivation,
              defaults.sort,
            ])}
            initial={defaults}
            apply={(value) =>
              update({
                ...value,
                page: undefined,
                userId: undefined,
                applicationPage: undefined,
                userView: undefined,
                publicPage: undefined,
                recordPage: undefined,
                recordKind: undefined,
              })
            }
          />
        </CardContent>
      </Card>
      {!input && <FormNotice error="筛选条件无效，请核对搜索、角色、状态或页码" />}
      {search.has('userId') && !selected.success && (
        <>
          <FormNotice error="用户链接无效，请从列表重新选择" />
          <Button variant="outline" onClick={() => update({ userId: undefined }, true)}>
            关闭无效用户链接
          </Button>
        </>
      )}
      {dirty && remembered && !selected.success && (
        <div className="flex flex-col items-start gap-3">
          <FormNotice message="刚才的用户操作输入仍保留在当前页面" />
          <Button variant="outline" onClick={() => manage(remembered)}>
            继续用户操作
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground">
          {query.data ? `共 ${query.data.meta.total} 位用户` : '读取有权限访问的用户列表'}
        </p>
        <Button
          variant="outline"
          disabled={!input || query.isFetching}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? '正在读取…' : '刷新用户列表'}
        </Button>
      </div>
      {query.isError && <FormNotice error={query.error} />}
      {input && query.isPending && (
        <div className="grid gap-4">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-40 w-full" />
          ))}
        </div>
      )}
      {query.data && query.data.data.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              <h2>没有符合条件的用户</h2>
            </EmptyTitle>
            <EmptyDescription>尝试调整搜索内容、角色或账号状态</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {query.data && query.data.data.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-4">
          {query.data.data.map((user) => (
            <li key={user.id}>
              <Card>
                <CardHeader className="gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="flex min-w-0 flex-col gap-2">
                    <CardTitle className="break-words">{user.username}</CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{roleLabel(user.role)}</Badge>
                      <Badge variant="secondary">{statusLabel(user.status)}</Badge>
                      {user.pendingDeactivation && <Badge variant="outline">申请停用</Badge>}
                      <Badge variant="outline">
                        {user.emailVerified ? '邮箱已验证' : '邮箱待验证'}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => manage(user.id)}
                    aria-label={'管理 ' + user.username}
                  >
                    管理用户
                  </Button>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">作品</dt>
                      <dd>{user.personaCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">有效会话</dt>
                      <dd>{user.activeSessionCount}</dd>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <dt className="text-muted-foreground">注册时间</dt>
                      <dd>{new Date(user.createdAt).toLocaleDateString('zh-CN')}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {input && query.data && (
        <nav aria-label="用户列表分页" className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="outline"
            disabled={input.page <= 1}
            onClick={() => update({ page: String(input.page - 1), userId: undefined })}
          >
            上一页
          </Button>
          <span>
            第 {input.page} / {totalPages} 页
          </span>
          <Button
            variant="outline"
            disabled={input.page >= totalPages}
            onClick={() => update({ page: String(input.page + 1), userId: undefined })}
          >
            下一页
          </Button>
        </nav>
      )}
      {remembered && (
        <AdminUserDetail
          key={remembered}
          id={remembered}
          accountId={accountId}
          open={selected.success && selected.data === remembered}
          close={() => update({ userId: undefined }, true)}
          changed={changed}
          onDirty={setDirty}
        />
      )}
    </div>
  );
}

function AdminUsersBoundary() {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const auth = useQuery(authQuery);
  if (!hydrated || auth.isPending) return <Skeleton className="h-64 w-full" />;
  if (auth.isError)
    return (
      <>
        <FormNotice error={auth.error} />
        <Button onClick={() => void auth.refetch()}>重新确认登录状态</Button>
      </>
    );
  const account = auth.data.data.account;
  if (!account || auth.data.data.assurance !== 'authenticated')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <h1>{account ? '请完成登录验证' : '请先登录'}</h1>
          </EmptyTitle>
          <EmptyDescription>用户管理需要有效的管理员账号</EmptyDescription>
        </EmptyHeader>
        <Button render={<Link href={account ? '/mfa' : '/login'} />}>
          {account ? '完成登录验证' : '前往登录'}
        </Button>
      </Empty>
    );
  if (account.role !== 'admin')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <h1>你没有用户管理权限</h1>
          </EmptyTitle>
          <EmptyDescription>请使用管理员账号访问用户管理</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return <AuthorizedUsers key={account.id} accountId={account.id} />;
}

export function AdminUsersWorkspace() {
  return (
    <AdminUserDraftProvider>
      <AdminUsersBoundary />
    </AdminUserDraftProvider>
  );
}
