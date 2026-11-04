'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CommentModerationQuerySchema,
  IdSchema,
  type AdminCommentSchema,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Badge } from '@personamarket/ui/components/badge';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Field, FieldGroup, FieldLabel, FieldError } from '@personamarket/ui/components/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@personamarket/ui/components/select';
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
import { commentsApi, moderationCommentsKey } from '@/lib/comments-api';
import { FormNotice } from '../auth/auth-fields';
import { PageIntro } from '../page-layout';
import { CommentBulkReview } from './comment-bulk-review';
import { CommentReviewDetail } from './comment-review-detail';
import { commentStatusLabels } from './comment-manage';

const subscribe = () => () => {};
type Snapshot = z.infer<typeof AdminCommentSchema>;
const FilterSchema = z.strictObject({
  status: CommentModerationQuerySchema.shape.status,
  personaId: z.union([IdSchema, z.literal('')]),
  sort: CommentModerationQuerySchema.shape.sort,
});
const statuses = [
  { value: 'PENDING', label: '待审核' },
  { value: 'APPROVED', label: '已通过' },
  { value: 'REJECTED', label: '已驳回' },
  { value: 'hidden', label: '已隐藏' },
  { value: 'all', label: '全部状态' },
] as const;
function Filters({
  initial,
  apply,
}: {
  initial: z.infer<typeof FilterSchema>;
  apply: (value: z.infer<typeof FilterSchema>) => void;
}) {
  const form = useForm<z.input<typeof FilterSchema>, unknown, z.output<typeof FilterSchema>>({
    resolver: zodResolver(FilterSchema),
    defaultValues: initial,
  });
  return (
    <form noValidate onSubmit={form.handleSubmit(apply)}>
      <FieldGroup className="grid items-start sm:grid-cols-2 xl:grid-cols-[12rem_minmax(0,1fr)_12rem_auto]">
        <Controller
          control={form.control}
          name="status"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="comment-filter-status">审核状态</FieldLabel>
              <Select
                items={[...statuses]}
                value={field.value}
                onValueChange={(value) => {
                  if (value) field.onChange(value);
                }}
              >
                <SelectTrigger id="comment-filter-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {statuses.map((item) => (
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
        <Field data-invalid={Boolean(form.formState.errors.personaId)}>
          <FieldLabel htmlFor="comment-filter-persona">作品 ID</FieldLabel>
          <Input
            id="comment-filter-persona"
            placeholder="留空查看所有作品"
            {...form.register('personaId')}
            aria-invalid={Boolean(form.formState.errors.personaId)}
          />
          <FieldError errors={[form.formState.errors.personaId]} />
        </Field>
        <Controller
          control={form.control}
          name="sort"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="comment-filter-sort">提交排序</FieldLabel>
              <Select
                items={[
                  { value: 'oldest', label: '较早提交优先' },
                  { value: 'newest', label: '较新提交优先' },
                ]}
                value={field.value}
                onValueChange={(value) => {
                  if (value) field.onChange(value);
                }}
              >
                <SelectTrigger id="comment-filter-sort" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="oldest">较早提交优先</SelectItem>
                    <SelectItem value="newest">较新提交优先</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        />
        <Button type="submit" className="self-end">
          筛选评论
        </Button>
      </FieldGroup>
    </form>
  );
}
function AuthorizedWorkspace({ accountId, role }: { accountId: string; role: string }) {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const client = useQueryClient();
  const parsed = CommentModerationQuerySchema.safeParse({
    page: search.get('page') ?? 1,
    pageSize: 20,
    status: search.get('status') ?? 'PENDING',
    sort: search.get('sort') ?? 'oldest',
    ...(search.get('personaId') ? { personaId: search.get('personaId') } : {}),
  });
  const input = parsed.success ? parsed.data : undefined;
  const detail = IdSchema.safeParse(search.get('commentId'));
  const [selected, setSelected] = useState<Record<string, Snapshot>>({});
  const [batch, setBatch] = useState<[Snapshot, ...Snapshot[]]>();
  const query = useQuery({
    queryKey: [...moderationCommentsKey(accountId), 'queue', input ?? search.toString()],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('筛选条件无效，请修正作品 ID、状态或页码');
      return commentsApi.queue(accountId, input, signal);
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
  async function changed() {
    await Promise.all([
      client.invalidateQueries({ queryKey: moderationCommentsKey(accountId) }),
      client.invalidateQueries({ queryKey: ['private', 'review-indicators', accountId] }),
      client.invalidateQueries({ queryKey: ['public', 'comments'] }),
      client.invalidateQueries({ queryKey: ['private', 'comments'] }),
    ]);
    setSelected({});
  }
  const totalPages = query.data
    ? Math.max(1, Math.ceil(query.data.meta.total / query.data.meta.pageSize))
    : 1;
  const selectedCount = Object.keys(selected).length;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageIntro
        eyebrow="管理后台 · 内容审核"
        title="评论审核"
        description="核对具体文本快照，编辑评论不会直接替换旧获批内容"
      />
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" render={<Link href="/admin/moderation" />}>
          版本审核
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setSelected({});
            void query.refetch();
          }}
          disabled={query.isFetching || !input}
        >
          刷新队列
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>筛选审核队列</h2>
          </CardTitle>
          <CardDescription>审核员与管理员可处理他人评论，管理员自审需明确确认</CardDescription>
        </CardHeader>
        <CardContent>
          <Filters
            key={
              (search.get('status') ?? '') +
              ':' +
              (search.get('personaId') ?? '') +
              ':' +
              (search.get('sort') ?? '')
            }
            initial={{
              status: input?.status ?? 'PENDING',
              sort: input?.sort ?? 'oldest',
              personaId: search.get('personaId') ?? '',
            }}
            apply={(value) => {
              setSelected({});
              update({
                status: value.status,
                personaId: value.personaId || undefined,
                sort: value.sort,
                page: undefined,
                commentId: undefined,
              });
            }}
          />
        </CardContent>
      </Card>
      {!parsed.success && <FormNotice error="筛选条件无效，请修正作品 ID、状态或页码" />}
      {query.isPending && input && <Skeleton className="h-48 w-full" />}
      <FormNotice error={query.error} />
      {query.isError && (
        <Button variant="outline" onClick={() => void query.refetch()}>
          重新读取审核队列
        </Button>
      )}
      {query.data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              共 {query.data.meta.total} 条评论，已选择 {selectedCount} 条
            </p>
            <Button
              disabled={!selectedCount}
              onClick={() => {
                const [first, ...rest] = Object.values(selected);
                if (first) setBatch([first, ...rest]);
              }}
            >
              批量审核所选评论
            </Button>
          </div>
          {query.data.data.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>没有符合条件的评论</EmptyTitle>
                <EmptyDescription>调整筛选条件或稍后刷新审核队列</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            {query.data.data.map((row) => (
              <Card key={row.id} className="min-w-0" aria-label="评论审核记录">
                <CardHeader>
                  <CardTitle>
                    <h2 className="break-all">@{row.author.username}</h2>
                  </CardTitle>
                  <CardDescription>
                    {row.personaTitle ?? '作品当前不可公开'}
                    {row.release ? ' · v' + row.release.version : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex min-w-0 flex-col gap-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{commentStatusLabels[row.latest.status]}</Badge>
                    <Badge variant="outline">文本 #{row.latest.number}</Badge>
                    {row.visibility !== 'normal' && (
                      <Badge variant="outline">
                        {row.visibility === 'hidden' ? '已隐藏' : '已删除'}
                      </Badge>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-base leading-7 [overflow-wrap:anywhere]">
                    {row.latest.body}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {row.latest.status === 'PENDING' && row.visibility === 'normal' && (
                      <Field orientation="horizontal" className="w-auto">
                        <FieldLabel
                          htmlFor={'select-comment-' + row.id}
                          className="min-h-11 cursor-pointer items-center gap-2"
                        >
                          <Checkbox
                            id={'select-comment-' + row.id}
                            checked={Boolean(selected[row.id])}
                            disabled={role !== 'admin' && row.author.id === accountId}
                            onCheckedChange={(checked) =>
                              setSelected((previous) => {
                                const next = { ...previous };
                                if (checked) {
                                  if (Object.keys(next).length >= 20) return previous;
                                  next[row.id] = row;
                                } else delete next[row.id];
                                return next;
                              })
                            }
                          />
                          选择当前文本
                        </FieldLabel>
                      </Field>
                    )}
                    <Button variant="outline" onClick={() => update({ commentId: row.id }, true)}>
                      查看审核详情
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <nav
            aria-label="评论审核分页"
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <Button
              variant="outline"
              disabled={query.isFetching || !input || input.page <= 1}
              onClick={() => {
                setSelected({});
                update({ page: String(Math.max(1, (input?.page ?? 1) - 1)) });
              }}
            >
              上一页
            </Button>
            <span className="text-sm text-muted-foreground">
              第 {input?.page ?? 1} / {totalPages} 页
            </span>
            <Button
              variant="outline"
              disabled={query.isFetching || !input || input.page >= totalPages}
              onClick={() => {
                setSelected({});
                update({ page: String((input?.page ?? 1) + 1) });
              }}
            >
              下一页
            </Button>
          </nav>
        </>
      )}
      {detail.success && (
        <CommentReviewDetail
          key={accountId + ':' + detail.data}
          id={detail.data}
          accountId={accountId}
          role={role}
          onClose={() => update({ commentId: undefined }, true)}
          changed={changed}
        />
      )}
      {batch && (
        <CommentBulkReview
          selected={batch}
          accountId={accountId}
          onClose={() => setBatch(undefined)}
          changed={changed}
        />
      )}
    </div>
  );
}
export function CommentReviewWorkspace() {
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
  if (!account)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>请先登录</EmptyTitle>
          <EmptyDescription>评论审核需要有效的审核员或管理员账号</EmptyDescription>
        </EmptyHeader>
        <Button render={<Link href="/login" />}>前往登录</Button>
      </Empty>
    );
  if (auth.data.data.assurance !== 'authenticated')
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>请完成登录验证</EmptyTitle>
          <EmptyDescription>已绑定 MFA 的账号需完成登录验证后继续</EmptyDescription>
        </EmptyHeader>
        <Button render={<Link href="/mfa" />}>完成登录验证</Button>
      </Empty>
    );
  if (!['admin', 'moderator'].includes(account.role))
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>你没有评论审核权限</EmptyTitle>
          <EmptyDescription>请使用有权限的账号访问审核队列</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return <AuthorizedWorkspace key={account.id} accountId={account.id} role={account.role} />;
}
