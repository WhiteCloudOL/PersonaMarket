'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AdminAnnouncementsQuerySchema,
  IdSchema,
  type AdminAnnouncementsQuery,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
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
import { announcementsApi, announcementsKey } from '@/lib/announcements-api';
import { FormNotice } from '../auth/auth-fields';
import { PageIntro } from '../page-layout';
import { AnnouncementEditor } from './editor';
import { announcementDate } from './announcement-content';

const subscribe = () => () => {};
const FilterSchema = AdminAnnouncementsQuerySchema.pick({ q: true, status: true });
export const announcementStatuses = {
  draft: '未发布',
  published: '已公开',
  withdrawn: '已撤回',
  archived: '已归档',
};
const statuses = [
  { value: 'all', label: '全部状态' },
  ...Object.entries(announcementStatuses).map(([value, label]) => ({ value, label })),
];
function Filters({
  initial,
  apply,
}: {
  initial: AdminAnnouncementsQuery;
  apply: (value: z.infer<typeof FilterSchema>) => void;
}) {
  const form = useForm<z.input<typeof FilterSchema>, unknown, z.infer<typeof FilterSchema>>({
    resolver: zodResolver(FilterSchema),
    defaultValues: { q: initial.q, status: initial.status },
  });
  return (
    <form noValidate onSubmit={form.handleSubmit(apply)}>
      <FieldGroup className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.4fr)_auto]">
        <Field data-invalid={Boolean(form.formState.errors.q)}>
          <FieldLabel htmlFor="announcement-search">搜索标题或 ID</FieldLabel>
          <Input
            id="announcement-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            {...form.register('q')}
            aria-invalid={Boolean(form.formState.errors.q)}
          />
          <FieldError errors={[form.formState.errors.q]} />
        </Field>
        <Controller
          name="status"
          control={form.control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="announcement-status">公告状态</FieldLabel>
              <Select
                items={statuses}
                value={field.value}
                onValueChange={(value) => {
                  if (value) field.onChange(value);
                }}
              >
                <SelectTrigger id="announcement-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {statuses.map((option) => (
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
        <Button type="submit">筛选公告</Button>
      </FieldGroup>
    </form>
  );
}
function AuthorizedAnnouncements({ accountId }: { accountId: string }) {
  const search = useSearchParams(),
    pathname = usePathname(),
    router = useRouter();
  const [remembered, setRemembered] = useState('');
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string>();
  const parsed = AdminAnnouncementsQuerySchema.safeParse(
    Object.fromEntries(
      ['q', 'status', 'page'].flatMap((key) => {
        const value = search.get(key);
        return value === null ? [] : [[key, value]];
      }),
    ),
  );
  const input = parsed.success ? parsed.data : undefined;
  const raw = search.get('entry');
  const selected = raw === 'new' || IdSchema.safeParse(raw).success ? raw : undefined;
  if (selected && selected !== remembered) setRemembered(selected);
  const query = useQuery({
    queryKey: [...announcementsKey(accountId), 'list', input ?? search.toString()],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('公告筛选条件无效');
      return announcementsApi.list(accountId, input, signal);
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
    return !dirty || window.confirm('还有未保存的公告操作，确定切换吗');
  }
  function close() {
    setDirty(false);
    setVersion((value) => value + 1);
    navigate({ entry: undefined, recordsPage: undefined }, true);
  }
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageIntro
        eyebrow="管理后台"
        title="公告管理"
        description="整理编辑稿，核对后发布站点消息，保留每次处理记录"
      />
      <Card>
        <CardHeader>
          <CardTitle>查找公告</CardTitle>
          <CardDescription>保存编辑稿后再核对发布，读者继续看到上次公开的内容</CardDescription>
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
              <Button variant="outline" onClick={() => router.replace(pathname)}>
                清空筛选
              </Button>
            </>
          )}
        </CardContent>
      </Card>
      {notice && (
        <p role="status" className="text-sm text-primary">
          {notice}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {query.data ? `共 ${query.data.meta.total} 条公告` : '正在核对公告目录…'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={query.isFetching || !input}
            onClick={() => void query.refetch()}
          >
            刷新公告
          </Button>
          <Button
            onClick={() => {
              if (!discard()) return;
              setVersion((value) => value + 1);
              setDirty(false);
              navigate({ entry: 'new', recordsPage: undefined });
            }}
          >
            新建公告
          </Button>
        </div>
      </div>
      {query.isPending && input ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <>
          <FormNotice error={query.error} />
          <Button variant="outline" onClick={() => void query.refetch()}>
            重试读取公告
          </Button>
        </>
      ) : (
        query.data && (
          <>
            {!query.data.data.length ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    {query.data.meta.total ? '这一页没有公告' : '没有符合条件的公告'}
                  </EmptyTitle>
                  <EmptyDescription>
                    {query.data.meta.total
                      ? '可以返回第一页继续核对当前目录'
                      : '调整筛选条件，或从一份新的编辑稿开始'}
                  </EmptyDescription>
                </EmptyHeader>
                {query.data.meta.total > 0 && (
                  <Button variant="outline" onClick={() => navigate({ page: undefined })}>
                    返回第一页
                  </Button>
                )}
              </Empty>
            ) : (
              <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                {query.data.data.map((item) => (
                  <Card key={item.id}>
                    <CardHeader>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={item.status === 'published' ? 'secondary' : 'outline'}>
                          {announcementStatuses[item.status]}
                        </Badge>
                        {item.status === 'published' && item.hasUnpublishedChanges && (
                          <Badge variant="outline">编辑稿有更新</Badge>
                        )}
                        {item.pinned && <Badge variant="outline">编辑稿置顶</Badge>}
                      </div>
                      <CardTitle className="[overflow-wrap:anywhere]">{item.title}</CardTitle>
                      <CardDescription>
                        核对修订 {item.revision} · 更新于 {announcementDate(item.updatedAt)}
                      </CardDescription>
                      {item.publishedTitle && item.publishedTitle !== item.title && (
                        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                          上次发布标题：{item.publishedTitle}
                        </p>
                      )}
                    </CardHeader>
                    <CardContent>
                      <Button
                        variant="outline"
                        className="w-full"
                        aria-label="管理公告"
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
                aria-label="管理公告分页"
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <Button
                  variant="outline"
                  disabled={input.page <= 1}
                  onClick={() => navigate({ page: String(input.page - 1) })}
                >
                  上一页
                </Button>
                <span className="text-sm">第 {input.page} 页</span>
                <Button
                  variant="outline"
                  disabled={
                    input.page >= 100 || input.page * input.pageSize >= query.data.meta.total
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
        <AnnouncementEditor
          key={remembered + ':' + version}
          accountId={accountId}
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
export function AdminAnnouncementsWorkspace() {
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
          <EmptyDescription>使用有效管理员账号维护站点公告</EmptyDescription>
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
            <h1>你没有公告管理权限</h1>
          </EmptyTitle>
          <EmptyDescription>请使用管理员账号访问此页面</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return <AuthorizedAnnouncements key={account.id} accountId={account.id} />;
}
