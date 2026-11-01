'use client';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AdminGuidesQuerySchema,
  GuideSlugSchema,
  type AdminGuidesQuery,
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
import { guidesApi, guidesKey } from '@/lib/guides-api';
import { FormNotice } from '../auth/auth-fields';
import { PageIntro } from '../page-layout';
import { announcementDate } from '../announcements/announcement-content';
import { GuideEditor } from './editor';
import { guideLabel, guideStatuses } from './guide-labels';
const subscribe = () => () => {};
const statuses = [
  { value: 'all', label: '全部状态' },
  ...Object.entries(guideStatuses).map(([value, label]) => ({ value, label })),
];
function Filters({
  initial,
  apply,
}: {
  initial: AdminGuidesQuery;
  apply: (value: AdminGuidesQuery) => void;
}) {
  const form = useForm<z.input<typeof AdminGuidesQuerySchema>, unknown, AdminGuidesQuery>({
    resolver: zodResolver(AdminGuidesQuerySchema),
    defaultValues: initial,
  });
  return (
    <form noValidate onSubmit={form.handleSubmit(apply)}>
      <FieldGroup className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.4fr)_auto]">
        <Field data-invalid={Boolean(form.formState.errors.q)}>
          <FieldLabel htmlFor="guide-search">搜索指南标题</FieldLabel>
          <Input
            id="guide-search"
            type="search"
            autoComplete="off"
            aria-invalid={Boolean(form.formState.errors.q)}
            {...form.register('q')}
          />
          <FieldError errors={[form.formState.errors.q]} />
        </Field>
        <Controller
          name="status"
          control={form.control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="guide-status">指南状态</FieldLabel>
              <Select
                items={statuses}
                value={field.value}
                onValueChange={(value) => {
                  if (value) field.onChange(value);
                }}
              >
                <SelectTrigger id="guide-status" className="w-full">
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
        <Button type="submit">筛选指南</Button>
      </FieldGroup>
    </form>
  );
}
function AuthorizedGuides({ accountId }: { accountId: string }) {
  const search = useSearchParams(),
    pathname = usePathname(),
    router = useRouter();
  const parsed = AdminGuidesQuerySchema.safeParse(
    Object.fromEntries(
      ['q', 'status'].flatMap((key) => {
        const value = search.get(key);
        return value === null ? [] : [[key, value]];
      }),
    ),
  );
  const input = parsed.success ? parsed.data : undefined;
  const selected = GuideSlugSchema.safeParse(search.get('guide'));
  const query = useQuery({
    queryKey: [...guidesKey(accountId), 'list', input ?? search.toString()],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('指南筛选条件无效');
      return guidesApi.list(accountId, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  function navigate(values: Record<string, string | undefined>, replace = false) {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(values))
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
    const url = pathname + (next.size ? '?' + next.toString() : '');
    if (replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  }
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageIntro
        eyebrow="管理后台"
        title="指南内容"
        description="维护使用教程，核对编辑稿后发布，保留每次修订记录"
      />
      <Card>
        <CardHeader>
          <CardTitle>查找指南</CardTitle>
          <CardDescription>按既有章节维护教程，开源许可和致谢由项目文档统一维护</CardDescription>
        </CardHeader>
        <CardContent>
          {input ? (
            <Filters
              key={JSON.stringify(input)}
              initial={input}
              apply={(value) => navigate({ ...value, guide: undefined, historyPage: undefined })}
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
      {search.has('guide') && !selected.success && (
        <>
          <FormNotice error={new Error('指南章节无效，请从目录重新选择')} />
          <Button
            variant="outline"
            onClick={() => navigate({ guide: undefined, historyPage: undefined }, true)}
          >
            返回指南目录
          </Button>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {query.data ? `共 ${query.data.data.length} 个符合条件的章节` : '正在核对指南目录…'}
        </p>
        <Button
          variant="outline"
          disabled={query.isFetching || !input}
          onClick={() => void query.refetch()}
        >
          刷新指南
        </Button>
      </div>
      {query.isPending && input ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <>
          <FormNotice error={query.error} />
          <Button variant="outline" onClick={() => void query.refetch()}>
            重试读取指南
          </Button>
        </>
      ) : (
        query.data &&
        (query.data.data.length ? (
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            {query.data.data.map((item) => (
              <Card key={item.slug}>
                <CardHeader>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={item.status === 'published' ? 'secondary' : 'outline'}>
                      {guideStatuses[item.status]}
                    </Badge>
                    {item.hasUnpublishedChanges && <Badge variant="outline">编辑稿有更新</Badge>}
                  </div>
                  <CardTitle className="[overflow-wrap:anywhere]">{item.title}</CardTitle>
                  <CardDescription className="[overflow-wrap:anywhere]">
                    {guideLabel(item.slug)} · 修订 {item.revision} · 更新于{' '}
                    {announcementDate(item.updatedAt)}
                  </CardDescription>
                  {item.summary && (
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {item.summary}
                    </p>
                  )}
                  {item.updatedBy && (
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      最近编辑：{item.updatedBy}
                    </p>
                  )}
                  {item.publishedTitle && item.publishedTitle !== item.title && (
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      上次发布标题：{item.publishedTitle}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    aria-label={'编辑指南：' + item.title}
                    onClick={() => navigate({ guide: item.slug, historyPage: undefined })}
                  >
                    查看并编辑
                  </Button>
                  {item.status === 'published' && (
                    <Button
                      variant="ghost"
                      render={<Link href={'/guides/' + item.slug} prefetch={false} />}
                    >
                      阅读公开指南
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>没有符合条件的指南</EmptyTitle>
              <EmptyDescription>调整标题或状态筛选，再查看现有章节</EmptyDescription>
            </EmptyHeader>
            <Button variant="outline" onClick={() => navigate({ q: undefined, status: undefined })}>
              清空筛选
            </Button>
          </Empty>
        ))
      )}
      {selected.success && (
        <GuideEditor
          key={selected.data}
          accountId={accountId}
          slug={selected.data}
          close={() => navigate({ guide: undefined, historyPage: undefined }, true)}
        />
      )}
    </div>
  );
}
export function AdminGuidesWorkspace() {
  const hydrated = useSyncExternalStore(
      subscribe,
      () => true,
      () => false,
    ),
    auth = useQuery(authQuery);
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
          <EmptyDescription>使用有效管理员账号维护指南内容</EmptyDescription>
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
            <h1>你没有指南管理权限</h1>
          </EmptyTitle>
          <EmptyDescription>请使用管理员账号访问此页面</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return <AuthorizedGuides key={account.id} accountId={account.id} />;
}
