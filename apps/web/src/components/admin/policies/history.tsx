'use client';
import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  PolicySubmissionsQuerySchema,
  PolicyRecordsQuerySchema,
  type ManagedPolicy,
  type PolicySlug,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@personamarket/ui/components/select';
import { Field, FieldLabel } from '@personamarket/ui/components/field';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { FormNotice } from '@/components/auth/auth-fields';
import { GuideBody } from '@/components/guides/guide-body';
import { announcementDate } from '@/components/announcements/announcement-content';
import { policiesApi, policiesKey } from './api';
import { policyActions, policyStatuses, type PolicyIntent } from './labels';

const statusItems = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已批准' },
  { value: 'rejected', label: '已驳回' },
  { value: 'withdrawn', label: '已撤回' },
];
function Waiting() {
  return (
    <div role="status">
      <span className="sr-only">正在读取规则记录…</span>
      <Skeleton className="h-32 w-full" aria-hidden="true" />
    </div>
  );
}
function EmptyRecords({ text }: { text: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{text}</EmptyTitle>
        <EmptyDescription>新记录会在真实操作成功后显示</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
function Pages({
  page,
  total,
  disabled,
  onPage,
}: {
  page: number;
  total: number;
  disabled: boolean;
  onPage: (value: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="basis-full text-sm text-muted-foreground">
        第 {page} 页 · 共 {total} 条记录 · 每页最多 20 条
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        上一页
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || page >= 100 || page * 20 >= total}
        onClick={() => onPage(page + 1)}
      >
        下一页
      </Button>
    </div>
  );
}
export function PolicySubmissionDetails({
  accountId,
  slug,
  id,
  publishedId,
  busy,
  close,
  onIntent,
}: {
  accountId: string;
  slug: PolicySlug;
  id: string;
  publishedId: string | null;
  busy: boolean;
  close: () => void;
  onIntent: (value: PolicyIntent) => void;
}) {
  const query = useQuery({
    queryKey: [...policiesKey(accountId), 'submissions', slug, 'detail', id],
    queryFn: ({ signal }) => policiesApi.submission(accountId, slug, id, signal),
    retry: false,
  });
  const item = query.data?.data;
  function prepare(kind: 'withdraw' | 'activate' | 'approve' | 'reject') {
    if (!query.data || query.isFetching || busy) return;
    const base = { revision: query.data.meta.revision, submission: query.data.data };
    close();
    onIntent(
      kind === 'approve' || kind === 'reject'
        ? { ...base, kind: 'review', decision: kind === 'approve' ? 'approve' : 'reject' }
        : { ...base, kind },
    );
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent className="flex max-h-dvh min-w-0 flex-col sm:max-w-2xl">
        <SheetHeader className="shrink-0">
          <SheetTitle>规则送审快照</SheetTitle>
          <SheetDescription>这里展示提交时冻结的内容，与当前草稿分别保存</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] [overflow-wrap:anywhere]">
          {query.isError && (
            <div className="flex flex-col items-start gap-3">
              <FormNotice error={query.error} />
              <Button type="button" variant="outline" onClick={() => void query.refetch()}>
                重新读取快照
              </Button>
            </div>
          )}
          {!item && query.isPending && <Waiting />}
          {item && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{policyStatuses[item.status]}</Badge>
                {item.selfReview && <Badge variant="outline">管理员自审</Badge>}
              </div>
              <h3 className="text-lg font-semibold">{item.snapshot.title}</h3>
              {item.snapshot.summary && (
                <p className="text-sm text-muted-foreground">{item.snapshot.summary}</p>
              )}
              <p className="text-sm text-muted-foreground">
                来源修订 {item.sourceRevision} · 送审人 {item.submittedBy.username} ·{' '}
                {announcementDate(item.submittedAt)}
              </p>
              {item.reviewedBy && (
                <p className="text-sm text-muted-foreground">
                  审核人 {item.reviewedBy.username} ·{' '}
                  {item.reviewedAt ? announcementDate(item.reviewedAt) : '时间未记录'}
                </p>
              )}
              {item.reason !== null && (
                <p className="whitespace-pre-wrap text-sm">
                  处理理由：{item.reason || '审核通过，未填写补充理由'}
                </p>
              )}
              <GuideBody text={item.snapshot.bodyMarkdown} />
              {item.status === 'pending' && (
                <section
                  aria-label="规则审核操作"
                  className="flex flex-col gap-3 rounded-xl border p-4"
                >
                  <p className="text-sm text-muted-foreground">
                    {item.selfReviewRequired
                      ? '你参与过本轮编辑或送审，批准或驳回需要按自审规则确认'
                      : '请核对冻结快照后处理，当前草稿可能已经继续编辑'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={busy || query.isFetching || query.isError}
                      onClick={() => prepare('approve')}
                      className="h-auto min-h-11 whitespace-normal py-2"
                    >
                      批准并公开
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || query.isFetching || query.isError}
                      onClick={() => prepare('reject')}
                      className="h-auto min-h-11 whitespace-normal py-2"
                    >
                      驳回快照
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || query.isFetching || query.isError}
                      onClick={() => prepare('withdraw')}
                      className="h-auto min-h-11 whitespace-normal py-2"
                    >
                      撤回送审
                    </Button>
                  </div>
                </section>
              )}
              {item.status === 'approved' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || query.isFetching || query.isError || item.id === publishedId}
                  onClick={() => prepare('activate')}
                  className="h-auto min-h-11 whitespace-normal py-2"
                >
                  {item.id === publishedId ? '当前公开版本' : '激活这个批准版本'}
                </Button>
              )}
              <p className="break-all text-xs text-muted-foreground">
                内容摘要 SHA-256：{item.contentHash}
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
function PolicyRecordDetails({
  accountId,
  slug,
  id,
  close,
}: {
  accountId: string;
  slug: PolicySlug;
  id: string;
  close: () => void;
}) {
  const query = useQuery({
    queryKey: [...policiesKey(accountId), 'records', slug, 'detail', id],
    queryFn: ({ signal }) => policiesApi.record(accountId, slug, id, signal),
    retry: false,
  });
  const record = query.data?.data;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent className="flex max-h-dvh min-w-0 flex-col sm:max-w-2xl">
        <SheetHeader className="shrink-0">
          <SheetTitle>规则处理记录</SheetTitle>
          <SheetDescription>按次记录当时的草稿、公开指针和送审状态</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] [overflow-wrap:anywhere]">
          {query.isError && (
            <div className="flex flex-col items-start gap-3">
              <FormNotice error={query.error} />
              <Button type="button" variant="outline" onClick={() => void query.refetch()}>
                重新读取处理记录
              </Button>
            </div>
          )}
          {!record && query.isPending && <Waiting />}
          {record && (
            <>
              <p className="font-medium">
                {policyActions[record.action]} · {record.actor.username}
              </p>
              <p className="text-sm text-muted-foreground">
                {announcementDate(record.createdAt)} · 修订 {record.before.revision} →{' '}
                {record.after.revision}
                {record.selfReview ? ' · 管理员自审' : ''}
              </p>
              <p className="whitespace-pre-wrap text-sm">
                处理理由：{record.reason || '未填写补充理由'}
              </p>
              <Tabs defaultValue="after" className="min-w-0">
                <TabsList aria-label="处理前后记录" className="h-auto min-h-12 w-full flex-wrap">
                  <TabsTrigger value="before" className="h-auto min-h-11 whitespace-normal">
                    处理前
                  </TabsTrigger>
                  <TabsTrigger value="after" className="h-auto min-h-11 whitespace-normal">
                    处理后
                  </TabsTrigger>
                </TabsList>
                {(['before', 'after'] as const).map((side) => (
                  <TabsContent key={side} value={side} className="flex min-w-0 flex-col gap-4">
                    <h3 className="font-semibold">{record[side].title || '空白草稿'}</h3>
                    {record[side].summary && (
                      <p className="text-sm text-muted-foreground">{record[side].summary}</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      公开版：{record[side].publishedId ? '存在已批准版本' : '未公开'} · 最近送审：
                      {record[side].latestSubmissionStatus
                        ? policyStatuses[record[side].latestSubmissionStatus]
                        : '暂无'}
                    </p>
                    <GuideBody text={record[side].bodyMarkdown} />
                    <p className="break-all text-xs text-muted-foreground">
                      草稿摘要 SHA-256：{record[side].contentHash}
                    </p>
                  </TabsContent>
                ))}
              </Tabs>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
function SubmissionHistory({
  accountId,
  snapshot,
  busy,
  onIntent,
}: {
  accountId: string;
  snapshot: ManagedPolicy;
  busy: boolean;
  onIntent: (value: PolicyIntent) => void;
}) {
  const params = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const parsed = PolicySubmissionsQuerySchema.safeParse({
    page: params.get('policyPage') ?? '1',
    status: params.get('policyStatus') ?? 'all',
  });
  const input = parsed.success ? parsed.data : PolicySubmissionsQuerySchema.parse({});
  const [selected, setSelected] = useState<string>();
  const query = useQuery({
    queryKey: [...policiesKey(accountId), 'submissions', snapshot.slug, input],
    queryFn: ({ signal }) => policiesApi.submissions(accountId, snapshot.slug, input, signal),
    retry: false,
  });
  function navigate(page: number, status: string = input.status) {
    const next = new URLSearchParams(params.toString());
    next.set('policyPage', String(page));
    next.set('policyStatus', status);
    router.replace(pathname + '?' + next.toString(), { scroll: false });
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="policy-history-status">送审记录状态</FieldLabel>
        <Select
          items={statusItems}
          value={input.status}
          onValueChange={(value) => {
            if (value) navigate(1, value);
          }}
          disabled={busy}
        >
          <SelectTrigger id="policy-history-status" className="max-w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {statusItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {query.isError && (
        <div className="flex flex-col items-start gap-3">
          <FormNotice error={query.error} />
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            重新读取送审记录
          </Button>
        </div>
      )}
      {query.isPending && <Waiting />}
      {query.data && (
        <>
          {query.isFetching && (
            <p role="status" className="text-sm text-muted-foreground">
              正在更新送审记录…
            </p>
          )}
          {query.data.data.length === 0 ? (
            <EmptyRecords text="当前条件下没有送审记录" />
          ) : (
            <ol className="flex min-w-0 flex-col divide-y rounded-xl border bg-card px-4">
              {query.data.data.map((item) => (
                <li
                  key={item.id}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{policyStatuses[item.status]}</Badge>
                      <span className="text-sm">来源修订 {item.sourceRevision}</span>
                      {item.id === snapshot.published?.publicationId && (
                        <Badge variant="outline">当前公开</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {item.submittedBy.username} · {announcementDate(item.submittedAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || query.isFetching || query.isError}
                    onClick={() => setSelected(item.id)}
                  >
                    查看快照
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <Pages
            page={input.page}
            total={query.data.meta.total}
            disabled={query.isFetching || busy}
            onPage={(page) => navigate(page)}
          />
        </>
      )}
      {selected && (
        <PolicySubmissionDetails
          key={selected}
          accountId={accountId}
          slug={snapshot.slug}
          id={selected}
          publishedId={snapshot.published?.publicationId ?? null}
          busy={busy}
          close={() => setSelected(undefined)}
          onIntent={onIntent}
        />
      )}
    </div>
  );
}
function RecordHistory({ accountId, slug }: { accountId: string; slug: PolicySlug }) {
  const params = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const parsed = PolicyRecordsQuerySchema.safeParse({
    page: params.get('policyRecordPage') ?? '1',
  });
  const input = parsed.success ? parsed.data : PolicyRecordsQuerySchema.parse({});
  const [selected, setSelected] = useState<string>();
  const query = useQuery({
    queryKey: [...policiesKey(accountId), 'records', slug, input],
    queryFn: ({ signal }) => policiesApi.records(accountId, slug, input.page, signal),
    retry: false,
  });
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {query.isError && (
        <div className="flex flex-col items-start gap-3">
          <FormNotice error={query.error} />
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            重新读取修改记录
          </Button>
        </div>
      )}
      {query.isPending && <Waiting />}
      {query.data && (
        <>
          {query.isFetching && (
            <p role="status" className="text-sm text-muted-foreground">
              正在更新修改记录…
            </p>
          )}
          {query.data.data.length === 0 ? (
            <EmptyRecords text="暂无规则处理记录" />
          ) : (
            <ol className="flex min-w-0 flex-col divide-y rounded-xl border bg-card px-4">
              {query.data.data.map((item) => (
                <li
                  key={item.id}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="font-medium">
                      {policyActions[item.action]} · 修订 {item.fromRevision} → {item.toRevision}
                    </p>
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {item.actor.username} · {announcementDate(item.createdAt)}
                      {item.selfReview ? ' · 管理员自审' : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={query.isFetching || query.isError}
                    onClick={() => setSelected(item.id)}
                  >
                    查看处理详情
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <Pages
            page={input.page}
            total={query.data.meta.total}
            disabled={query.isFetching}
            onPage={(page) => {
              const next = new URLSearchParams(params.toString());
              next.set('policyRecordPage', String(page));
              router.replace(pathname + '?' + next.toString(), { scroll: false });
            }}
          />
        </>
      )}
      {selected && (
        <PolicyRecordDetails
          key={selected}
          accountId={accountId}
          slug={slug}
          id={selected}
          close={() => setSelected(undefined)}
        />
      )}
    </div>
  );
}
export function PolicyHistory({
  accountId,
  snapshot,
  busy,
  onIntent,
}: {
  accountId: string;
  snapshot: ManagedPolicy;
  busy: boolean;
  onIntent: (value: PolicyIntent) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-11 max-w-full whitespace-normal py-2"
          />
        }
      >
        {open ? '收起历史与处理记录' : '查看历史与处理记录'}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">
        {open && (
          <Tabs defaultValue="submissions" className="min-w-0 gap-5">
            <TabsList aria-label="规则历史类型" className="h-auto min-h-12 w-full flex-wrap">
              <TabsTrigger value="submissions" className="h-auto min-h-11 whitespace-normal">
                送审与批准版本
              </TabsTrigger>
              <TabsTrigger value="records" className="h-auto min-h-11 whitespace-normal">
                修改与处理记录
              </TabsTrigger>
            </TabsList>
            <TabsContent value="submissions" className="min-w-0">
              <SubmissionHistory
                accountId={accountId}
                snapshot={snapshot}
                busy={busy}
                onIntent={onIntent}
              />
            </TabsContent>
            <TabsContent value="records" className="min-w-0">
              <RecordHistory accountId={accountId} slug={snapshot.slug} />
            </TabsContent>
          </Tabs>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
