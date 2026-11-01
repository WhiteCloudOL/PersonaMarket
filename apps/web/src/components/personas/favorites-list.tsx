'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkIcon } from 'lucide-react';
import type { z } from 'zod';
import { FavoritesQuerySchema, type FavoritesQuery } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Field, FieldGroup, FieldLabel, FieldError } from '@personamarket/ui/components/field';
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
  EmptyMedia,
  EmptyContent,
} from '@personamarket/ui/components/empty';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@personamarket/ui/components/select';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { authQuery } from '@/lib/auth-api';
import { favoritesKey, interactionsApi } from '@/lib/interactions-api';
import { favoritesHref, readFavoritesState } from '@/lib/favorites-state';
import { FormNotice } from '../auth/auth-fields';
import { PublicCardGrid } from './public-cards';
import { InteractionProvider } from './interaction-controls';

const filterRows = [
  {
    name: 'platform',
    label: '人设平台',
    items: [
      { value: 'all', label: '全部平台' },
      { value: 'maibot', label: 'MaiBot' },
      { value: 'astrbot', label: 'AstrBot' },
    ],
  },
  {
    name: 'availability',
    label: '作品状态',
    items: [
      { value: 'all', label: '全部状态' },
      { value: 'available', label: '可公开访问' },
      { value: 'unavailable', label: '暂不可用' },
    ],
  },
  {
    name: 'sort',
    label: '收藏排序',
    items: [
      { value: 'newest', label: '最近收藏' },
      { value: 'oldest', label: '最早收藏' },
      { value: 'updated', label: '作品最近更新' },
      { value: 'title', label: '作品名称' },
    ],
  },
] as const;

function FavoriteFilters({ input }: { input: FavoritesQuery }) {
  const router = useRouter();
  const form = useForm<z.input<typeof FavoritesQuerySchema>, undefined, FavoritesQuery>({
    resolver: zodResolver(FavoritesQuerySchema),
    values: input,
  });
  return (
    <Card>
      <CardContent>
        <form
          onSubmit={form.handleSubmit((data) => router.push(favoritesHref({ ...data, page: 1 })))}
          noValidate
          className="flex flex-col gap-4"
        >
          <FieldGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field data-invalid={Boolean(form.formState.errors.q)}>
              <FieldLabel htmlFor="favorites-search">作品名称</FieldLabel>
              <Input
                id="favorites-search"
                type="search"
                placeholder="搜索可公开作品…"
                aria-invalid={Boolean(form.formState.errors.q)}
                {...form.register('q')}
              />
              <FieldError errors={[form.formState.errors.q]} />
            </Field>
            {filterRows.map((row) => (
              <Controller
                key={row.name}
                name={row.name}
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor={'favorites-' + row.name}>{row.label}</FieldLabel>
                    <Select
                      items={row.items}
                      value={field.value ?? 'all'}
                      onValueChange={(value) => {
                        if (typeof value === 'string')
                          field.onChange(
                            row.name === 'platform' && value === 'all' ? undefined : value,
                          );
                      }}
                    >
                      <SelectTrigger id={'favorites-' + row.name} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {row.items.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
            ))}
          </FieldGroup>
          <div className="flex flex-wrap gap-3">
            <Button type="submit">筛选收藏</Button>
            <Button
              variant="outline"
              type="button"
              onClick={() => router.push('/dashboard/favorites')}
            >
              清除条件
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RemoveUnavailable({ id, accountId }: { id: string; accountId: string }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => interactionsApi.set(accountId, id, 'favorite', false),
    onSuccess: () => client.invalidateQueries({ queryKey: favoritesKey(accountId) }),
    retry: false,
  });
  return (
    <div className="flex flex-col gap-3">
      <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
        {mutation.isPending ? '正在移除…' : '移除不可用收藏'}
      </Button>
      <FormNotice error={mutation.error} />
    </div>
  );
}

export function FavoritesList() {
  const search = useSearchParams();
  const { input, invalid } = readFavoritesState(new URLSearchParams(search));
  const auth = useQuery(authQuery);
  const account = auth.data?.data.account;
  const authenticated = auth.data?.data.assurance === 'authenticated';
  const query = useQuery({
    queryKey: [...favoritesKey(account?.id ?? 'guest'), input],
    queryFn: ({ signal }) => interactionsApi.favorites(input, signal),
    enabled: Boolean(account && authenticated),
    retry: false,
  });
  if (auth.isPending) return <Skeleton className="h-36 w-full" aria-label="正在读取登录状态" />;
  if (auth.isError)
    return (
      <>
        <FormNotice error={auth.error} />
        <Button onClick={() => void auth.refetch()}>重试登录状态</Button>
      </>
    );
  if (!account)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>登录后查看你的收藏</EmptyTitle>
          <EmptyDescription>收藏仅自己可见</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link href="/login" />}>登录</Button>
        </EmptyContent>
      </Empty>
    );
  if (!authenticated) return <Button render={<Link href="/mfa" />}>完成登录验证后查看收藏</Button>;
  const data = query.data;
  const lastPage = Math.min(500, Math.max(1, Math.ceil((data?.meta.total ?? 0) / input.pageSize)));
  return (
    <>
      <FavoriteFilters input={input} />
      {invalid && <FormNotice error="筛选条件无效，已显示默认收藏列表" />}
      {query.isPending && <Skeleton className="h-40 w-full" aria-label="正在读取收藏" />}
      {query.isError && (
        <>
          <FormNotice error={query.error} />
          <Button onClick={() => void query.refetch()}>重新读取收藏</Button>
        </>
      )}
      {data && (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            共 {data.meta.total.toLocaleString('zh-CN')} 项收藏，仅你自己可见
          </p>
          {data.data.length ? (
            <InteractionProvider
              ids={data.data.filter((row) => row.available).map((row) => row.personaId)}
            >
              <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
                {data.data.map((row) => (
                  <div key={row.personaId} className="flex min-w-0 flex-col gap-2">
                    <p className="text-xs text-muted-foreground">
                      收藏于{' '}
                      <time dateTime={row.savedAt}>
                        {new Date(row.savedAt).toLocaleDateString('zh-CN')}
                      </time>
                    </p>
                    {row.available ? (
                      <PublicCardGrid items={[row.persona]} layout="list" />
                    ) : (
                      <Card>
                        <CardHeader>
                          <CardTitle>作品暂不可用</CardTitle>
                          <CardDescription>作品已隐藏或下架，你仍可移除此收藏</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <RemoveUnavailable id={row.personaId} accountId={account.id} />
                        </CardContent>
                      </Card>
                    )}
                  </div>
                ))}
              </div>
            </InteractionProvider>
          ) : (
            <Empty className="border bg-card">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BookmarkIcon aria-hidden />
                </EmptyMedia>
                <EmptyTitle>这里还没有收藏</EmptyTitle>
                <EmptyDescription>换一组筛选条件，或去发现喜欢的角色</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" render={<Link href="/explore" />}>
                  探索人设
                </Button>
              </EmptyContent>
            </Empty>
          )}
          <nav aria-label="收藏分页" className="flex flex-wrap items-center justify-between gap-3">
            {input.page > 1 ? (
              <Button
                variant="outline"
                render={<Link href={favoritesHref({ ...input, page: input.page - 1 })} />}
              >
                上一页收藏
              </Button>
            ) : (
              <Button variant="outline" disabled>
                上一页收藏
              </Button>
            )}
            <span className="text-sm text-muted-foreground">
              第 {input.page} / {lastPage} 页
            </span>
            {input.page < lastPage ? (
              <Button
                variant="outline"
                render={<Link href={favoritesHref({ ...input, page: input.page + 1 })} />}
              >
                下一页收藏
              </Button>
            ) : (
              <Button variant="outline" disabled>
                下一页收藏
              </Button>
            )}
          </nav>
          {data.meta.total > 500 * input.pageSize && (
            <p className="text-sm text-muted-foreground">
              最多翻阅 500 页，请使用平台或名称筛选缩小范围
            </p>
          )}
        </>
      )}
    </>
  );
}
