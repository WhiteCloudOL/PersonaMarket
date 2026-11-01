'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  IdSchema,
  TaxonomyManagementQuerySchema,
  type TaxonomyManagementQuery,
  type TaxonomyKind,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
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
import { Input } from '@personamarket/ui/components/input';
import { Field, FieldGroup, FieldLabel, FieldError } from '@personamarket/ui/components/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@personamarket/ui/components/select';
import { authQuery } from '@/lib/auth-api';
import { taxonomyManagementApi, taxonomyManagementKey } from '@/lib/taxonomy-management-api';
import { FormNotice } from '../auth/auth-fields';
import { PageIntro } from '../page-layout';
import { TaxonomyEditor } from './taxonomy-editor';

const subscribe = () => () => {};
const FilterSchema = TaxonomyManagementQuerySchema.pick({ q: true, state: true });
const states = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '已启用' },
  { value: 'disabled', label: '已停用' },
  { value: 'archived', label: '已归档' },
];
function Filters({
  initial,
  apply,
}: {
  initial: TaxonomyManagementQuery;
  apply: (value: z.infer<typeof FilterSchema>) => void;
}) {
  const form = useForm<z.input<typeof FilterSchema>, unknown, z.infer<typeof FilterSchema>>({
    resolver: zodResolver(FilterSchema),
    defaultValues: { q: initial.q, state: initial.state },
  });
  return (
    <form noValidate onSubmit={form.handleSubmit(apply)}>
      <FieldGroup className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.4fr)_auto]">
        <Field data-invalid={Boolean(form.formState.errors.q)}>
          <FieldLabel htmlFor="taxonomy-search">搜索名称或 ID</FieldLabel>
          <Input
            id="taxonomy-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="名称或完整条目 ID…"
            {...form.register('q')}
            aria-invalid={Boolean(form.formState.errors.q)}
          />
          <FieldError errors={[form.formState.errors.q]} />
        </Field>
        <Controller
          name="state"
          control={form.control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="taxonomy-state">目录状态</FieldLabel>
              <Select
                items={states}
                value={field.value}
                onValueChange={(value) => {
                  if (value) field.onChange(value);
                }}
              >
                <SelectTrigger id="taxonomy-state" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {states.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        />
        <Button type="submit">筛选目录</Button>
      </FieldGroup>
    </form>
  );
}
function AuthorizedTaxonomy({ accountId, kind }: { accountId: string; kind: TaxonomyKind }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [remembered, setRemembered] = useState('');
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string>();
  const parsed = TaxonomyManagementQuerySchema.safeParse(
    Object.fromEntries(
      ['q', 'state', 'page'].flatMap((key) => {
        const value = search.get(key);
        return value === null ? [] : [[key, value]];
      }),
    ),
  );
  const input = parsed.success ? parsed.data : undefined;
  const rawEntry = search.get('entry');
  const selected =
    rawEntry === 'new' || IdSchema.safeParse(rawEntry).success ? rawEntry : undefined;
  if (selected && selected !== remembered) setRemembered(selected);
  const query = useQuery({
    queryKey: [...taxonomyManagementKey(accountId, kind), 'list', input ?? search.toString()],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('目录筛选条件无效');
      return taxonomyManagementApi.list(accountId, kind, input, signal);
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
  function discard() {
    return !dirty || window.confirm('还有未保存的目录操作，确定切换吗');
  }
  function close() {
    setDirty(false);
    setVersion((value) => value + 1);
    navigate({ entry: undefined, recordsPage: undefined }, true);
  }
  const label = kind === 'category' ? '分类' : '标签';
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageIntro
        eyebrow="管理后台"
        title={label + '管理'}
        description="维护可选目录、排序和启用状态，保留历史作品中的名称快照"
      />
      <nav aria-label="目录管理导航" className="flex flex-wrap gap-2">
        <Link
          href="/admin/categories"
          aria-current={kind === 'category' ? 'page' : undefined}
          className={buttonVariants({ variant: kind === 'category' ? 'secondary' : 'outline' })}
        >
          分类管理
        </Link>
        <Link
          href="/admin/tags"
          aria-current={kind === 'tag' ? 'page' : undefined}
          className={buttonVariants({ variant: kind === 'tag' ? 'secondary' : 'outline' })}
        >
          标签管理
        </Link>
      </nav>
      <Card>
        <CardHeader>
          <CardTitle>查找{label}</CardTitle>
          <CardDescription>归档保留名称和记录，有草稿或历史版本引用时可停用</CardDescription>
        </CardHeader>
        <CardContent>
          {input ? (
            <Filters
              key={search.toString()}
              initial={input}
              apply={(value) => {
                if (!discard()) return;
                setRemembered('');
                setDirty(false);
                setVersion((value) => value + 1);
                navigate({ ...value, page: undefined, entry: undefined, recordsPage: undefined });
              }}
            />
          ) : (
            <>
              <FormNotice error={new Error('筛选条件无效，请清空后重试')} />
              <Button onClick={() => router.replace(pathname)}>清空筛选</Button>
            </>
          )}
        </CardContent>
      </Card>
      <FormNotice message={notice} />
      {rawEntry && !selected && <FormNotice error={new Error('条目标识无效，请从列表重新选择')} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" role="status">
          {query.data ? '共 ' + query.data.meta.total + ' 个条目' : '目录数据以实际查询结果为准'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isFetching || !input}
          >
            {query.isFetching ? '正在读取…' : '刷新目录'}
          </Button>
          <Button
            onClick={() => {
              if (!discard()) return;
              setVersion((value) => value + 1);
              setDirty(false);
              navigate({ entry: 'new', recordsPage: undefined });
            }}
          >
            新建{label}
          </Button>
        </div>
      </div>
      {query.isPending && input ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <>
          <FormNotice error={query.error} />
          <Button variant="outline" onClick={() => void query.refetch()}>
            重试读取目录
          </Button>
        </>
      ) : (
        query.data && (
          <>
            {!query.data.data.length ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>没有符合条件的{label}</EmptyTitle>
                  <EmptyDescription>调整筛选条件或创建新的目录条目</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                {query.data.data.map((item) => (
                  <Card key={item.id}>
                    <CardHeader>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={item.active ? 'secondary' : 'outline'}>
                          {item.archivedAt ? '已归档' : item.active ? '已启用' : '已停用'}
                        </Badge>
                        <Badge variant="outline">排序 {item.sortOrder}</Badge>
                      </div>
                      <CardTitle className="[overflow-wrap:anywhere]">{item.name}</CardTitle>
                      <CardDescription>核对修订 {item.revision}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        variant="outline"
                        className="w-full"
                        aria-label="管理条目"
                        onClick={() => {
                          if (remembered !== item.id && !discard()) return;
                          navigate({ entry: item.id, recordsPage: undefined });
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
                aria-label="目录分页"
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
                    input.page >= 50 || input.page * input.pageSize >= query.data.meta.total
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
      {remembered && (
        <TaxonomyEditor
          key={remembered + ':' + version}
          accountId={accountId}
          kind={kind}
          id={remembered}
          open={selected === remembered}
          close={close}
          onDirty={setDirty}
          notify={setNotice}
        />
      )}
    </div>
  );
}
export function TaxonomyWorkspace({ kind }: { kind: TaxonomyKind }) {
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
          <EmptyDescription>使用有效管理员账号维护创作目录</EmptyDescription>
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
            <h1>你没有目录管理权限</h1>
          </EmptyTitle>
          <EmptyDescription>请使用管理员账号访问此页面</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return <AuthorizedTaxonomy key={account.id + ':' + kind} accountId={account.id} kind={kind} />;
}
