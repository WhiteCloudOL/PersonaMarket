'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AdminPersonasQuerySchema, IdSchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Field, FieldLabel } from '@personamarket/ui/components/field';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { authQuery } from '@/lib/auth-api';
import { adminPersonasApi, adminPersonasKey, type AdminPersona } from '@/lib/admin-personas-api';
import { FormNotice } from '../auth/auth-fields';
import { PageIntro } from '../page-layout';
import { AdminPersonaFilters, type PersonaFilters } from './admin-persona-filters';
import { AdminPersonaDetail } from './admin-persona-detail';
import { PersonaBulkPanel } from './persona-bulk-panel';

const subscribe = () => () => {};
function AuthorizedPersonas({ accountId }: { accountId: string }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [remembered, setRemembered] = useState('');
  const [dirty, setDirty] = useState(false);
  const [detailVersion, setDetailVersion] = useState(0);
  const [selection, setSelection] = useState<AdminPersona[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const parsed = AdminPersonasQuerySchema.safeParse(
    Object.fromEntries(
      [
        'q',
        'platform',
        'ownerId',
        'categoryId',
        'state',
        'official',
        'featured',
        'sort',
        'page',
      ].flatMap((key) => {
        const value = search.get(key);
        return value === null ? [] : [[key, value]];
      }),
    ),
  );
  const input = parsed.success ? parsed.data : undefined;
  const selected = IdSchema.safeParse(search.get('personaId'));
  if (selected.success && selected.data !== remembered) setRemembered(selected.data);
  const query = useQuery({
    queryKey: [...adminPersonasKey(accountId), 'list', input ?? search.toString()],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('筛选条件无效，请核对页码、作者或分类');
      return adminPersonasApi.list(accountId, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  function navigate(values: Record<string, string | undefined>, replace = false) {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(values)) {
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
    }
    const url = pathname + (next.size ? '?' + next.toString() : '');
    if (replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  }
  function apply(value: PersonaFilters) {
    if (dirty && !window.confirm('还有未保存的管理操作，确定更换筛选条件吗')) return false;
    setRemembered('');
    setDirty(false);
    setDetailVersion((value) => value + 1);
    navigate({
      ...value,
      ownerId: value.ownerId,
      categoryId: value.categoryId,
      page: undefined,
      personaId: undefined,
      recordsPage: undefined,
    });
  }
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageIntro eyebrow="管理后台" title="人设管理" />
      <Card>
        <CardHeader>
          <CardTitle>查找人设</CardTitle>
        </CardHeader>
        <CardContent>
          {input ? (
            <AdminPersonaFilters key={search.toString()} initial={input} apply={apply} />
          ) : (
            <>
              <FormNotice error={new Error('筛选条件无效，请清空后重试')} />
              <Button onClick={() => router.replace(pathname)}>清空筛选</Button>
            </>
          )}
        </CardContent>
      </Card>
      {selection.length > 0 && (
        <div className="flex flex-wrap items-center gap-3" aria-label="批量操作工具">
          <p className="text-sm text-muted-foreground">
            已选 {selection.length}/20 条，保留选择时的修订
          </p>
          <Button
            variant="outline"
            disabled={selection.length === 0 || dirty}
            onClick={() => setBulkOpen(true)}
          >
            管理所选人设
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const first = selection[0]?.id;
              setSelection([]);
              (
                (first ? document.getElementById('select-persona-' + first) : null) ??
                document.getElementById('admin-personas-search')
              )?.focus();
            }}
          >
            清空选择
          </Button>
        </div>
      )}
      {query.isPending && input ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <>
          <FormNotice error={query.error} />
          <Button onClick={() => void query.refetch()}>重新读取列表</Button>
        </>
      ) : (
        query.data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status" className="text-sm text-muted-foreground">
                共 {query.data.meta.total} 条人设
              </p>
              <Button
                variant="outline"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                {query.isFetching ? '正在读取…' : '刷新列表'}
              </Button>
            </div>
            {query.data.data.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>没有符合条件的人设</EmptyTitle>
                  <EmptyDescription>调整筛选条件后再试试</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                {query.data.data.map((item) => (
                  <Card key={item.id}>
                    <CardHeader>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">
                          {item.platform === 'maibot' ? 'MaiBot' : 'AstrBot'}
                        </Badge>
                        <Badge variant="secondary">
                          {item.moderationState === 'blocked'
                            ? '已下架'
                            : item.ownerVisibility === 'hidden'
                              ? '作者隐藏'
                              : item.publiclyVisible
                                ? '公开展示'
                                : '未公开'}
                        </Badge>
                        {item.curation.official && <Badge>官方</Badge>}
                        {item.curation.featured && <Badge>精选</Badge>}
                      </div>
                      <CardTitle className="[overflow-wrap:anywhere]">
                        {item.title || '未命名人设'}
                      </CardTitle>
                      <CardDescription className="break-all">
                        {item.owner.username} · {item.category?.name ?? '未分类'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <Field orientation="horizontal">
                        <FieldLabel
                          htmlFor={'select-persona-' + item.id}
                          className="min-h-11 w-full gap-3 rounded-lg border border-border p-3"
                        >
                          <Checkbox
                            id={'select-persona-' + item.id}
                            aria-label={'选择' + (item.title || '未命名人设')}
                            checked={selection.some((value) => value.id === item.id)}
                            disabled={
                              selection.length >= 20 &&
                              !selection.some((value) => value.id === item.id)
                            }
                            onCheckedChange={(checked) =>
                              setSelection((previous) =>
                                checked
                                  ? previous.some((value) => value.id === item.id) ||
                                    previous.length >= 20
                                    ? previous
                                    : [...previous, item]
                                  : previous.filter((value) => value.id !== item.id),
                              )
                            }
                          />
                          加入批量操作
                        </FieldLabel>
                      </Field>
                      <p className="text-sm text-muted-foreground">
                        待审 {item.pendingCount} 个版本 · 核对修订 {item.revision}
                      </p>
                      <Button
                        variant="outline"
                        aria-label="管理这条人设"
                        onClick={() => {
                          if (
                            dirty &&
                            remembered !== item.id &&
                            !window.confirm('当前人设还有未保存的操作，确定切换吗')
                          )
                            return;
                          navigate({ personaId: item.id, recordsPage: undefined });
                        }}
                      >
                        查看并管理
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {input && (
              <nav
                aria-label="人设管理分页"
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <Button
                  variant="outline"
                  disabled={input.page <= 1}
                  onClick={() => navigate({ page: String(input.page - 1) })}
                >
                  上一页
                </Button>
                <span className="text-sm text-muted-foreground">第 {input.page} 页</span>
                <Button
                  variant="outline"
                  disabled={
                    input.page >= 2500 || input.page * input.pageSize >= query.data.meta.total
                  }
                  onClick={() => navigate({ page: String(input.page + 1) })}
                >
                  下一页
                </Button>
              </nav>
            )}
          </>
        )
      )}
      {selection.length > 0 && (
        <PersonaBulkPanel
          key={accountId}
          accountId={accountId}
          selected={selection}
          open={bulkOpen}
          close={() => {
            setBulkOpen(false);
            setSelection([]);
          }}
          finished={() => {
            setBulkOpen(false);
            setSelection([]);
          }}
        />
      )}
      {remembered && (
        <AdminPersonaDetail
          key={remembered + ':' + detailVersion}
          accountId={accountId}
          id={remembered}
          open={selected.success && selected.data === remembered}
          close={() => {
            setDetailVersion((value) => value + 1);
            setDirty(false);
            navigate({ personaId: undefined, recordsPage: undefined }, true);
          }}
          onDirty={setDirty}
        />
      )}
    </div>
  );
}

export function AdminPersonasWorkspace() {
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
          <EmptyDescription>使用有效的管理员账号管理人设</EmptyDescription>
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
            <h1>你没有人设管理权限</h1>
          </EmptyTitle>
          <EmptyDescription>请使用管理员账号访问此页面</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return <AuthorizedPersonas key={account.id} accountId={account.id} />;
}
