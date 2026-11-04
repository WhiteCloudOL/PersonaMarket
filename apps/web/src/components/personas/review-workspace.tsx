'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ReviewRequestSchema, canonicalJson } from '@personamarket/contracts';
import type { z } from 'zod';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { ArrowLeftIcon } from 'lucide-react';
import { PageIntro } from '../page-layout';
import { Badge } from '@personamarket/ui/components/badge';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
  FieldSet,
  FieldLegend,
} from '@personamarket/ui/components/field';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@personamarket/ui/components/tabs';
import { releasesApi } from '@/lib/releases-api';
import { authQuery } from '@/lib/auth-api';
import { FormNotice, SubmitButton } from '../auth/auth-fields';
import { EditorSection } from './editor-section';
import { SnapshotView, type Snapshot } from './snapshot-view';
import { submissionLabels } from './release-manager';
import { ReasonAction } from './reason-action';
import { PersonaModerationActions } from './persona-moderation-actions';
function SnapshotDiff({ previous, next }: { previous: Snapshot | null; next: Snapshot }) {
  const labels: Record<string, string> = {
    title: '名称',
    summary: '简介',
    content: '平台正文',
    readmeMarkdown: '作品介绍',
    origin: '来源许可',
    recommendedModels: '推荐模型',
    categoryId: '分类',
    tagIds: '标签',
    authorNotes: '作者说明',
    avatarAssetId: '头像',
    coverAssetId: '封面',
  };
  const keys = new Set([...Object.keys(previous ?? {}), ...Object.keys(next)]);
  const entries = [...keys].filter(
    (key) =>
      canonicalJson(Reflect.get(previous ?? {}, key)) !== canonicalJson(Reflect.get(next, key)),
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {previous ? '与当前公开版本逐字段比较，保留正文与空白差异' : '首次发布，以下为新增内容'}
      </p>
      {entries.length === 0 && <p className="text-sm">内容与当前公开版本一致</p>}
      {entries.map((key) => (
        <section key={key} className="overflow-hidden rounded-xl border bg-card">
          <h3 className="border-b px-4 py-3 text-sm font-medium">{labels[key] ?? key}</h3>
          <div className="grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="min-w-0 p-4">
              <p className="mb-2 text-xs text-muted-foreground">当前公开版本</p>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-6">
                {previous ? (JSON.stringify(Reflect.get(previous, key), null, 2) ?? '空') : '空'}
              </pre>
            </div>
            <div className="min-w-0 bg-accent/40 p-4">
              <p className="mb-2 text-xs text-primary">本次提交</p>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-6">
                {JSON.stringify(Reflect.get(next, key), null, 2) ?? '空'}
              </pre>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
function ReviewDetail({ id, refreshed }: { id: string; refreshed: () => void }) {
  const detail = useQuery({
    queryKey: ['private', 'review', id],
    queryFn: () => releasesApi.detail(id),
    retry: false,
  });
  const auth = useQuery(authQuery);
  const form = useForm<z.infer<typeof ReviewRequestSchema>>({
    resolver: zodResolver(ReviewRequestSchema),
    defaultValues: {
      action: 'approve',
      reason: '',
      selfReviewConfirmed: false,
      expectedRevision: 1,
    },
  });
  const selfConfirmed = useWatch({ control: form.control, name: 'selfReviewConfirmed' });
  const decision = useWatch({ control: form.control, name: 'action' });
  const operation = useRef<{ body: string; key: string } | undefined>(undefined);
  const mutation = useMutation({
    mutationFn: () => {
      const submission = detail.data?.data.submission;
      if (!submission) throw new Error('请先重新读取审核快照');
      const body = { ...form.getValues(), expectedRevision: submission.revision };
      const json = canonicalJson(body);
      if (operation.current?.body !== json)
        operation.current = { body: json, key: crypto.randomUUID() };
      return releasesApi.review(id, body, operation.current.key);
    },
    onSuccess: () => {
      void detail.refetch();
      refreshed();
    },
    retry: false,
  });
  const refresh = () => {
    void detail.refetch();
    refreshed();
  };
  if (detail.isPending) return <p role="status">正在读取审核快照…</p>;
  if (detail.isError)
    return (
      <div className="flex flex-col gap-4">
        <FormNotice error={detail.error} />
        <Button onClick={() => void detail.refetch()}>重新读取</Button>
      </div>
    );
  const { submission, previous, records, evidenceAssetIds } = detail.data.data;
  const viewer = auth.data?.data.account;
  const reviewingOwnWork = viewer?.username === submission.publication.publisher;
  const reviewerOwnWork = reviewingOwnWork && viewer?.role === 'moderator';
  return (
    <div className="flex flex-col gap-6">
      <EditorSection
        title={submission.snapshot.title + ' · v' + submission.version}
        description={
          '作者 ' +
          submission.publication.publisher +
          ' · 第 ' +
          submission.attemptNumber +
          ' 次提交'
        }
      >
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={submission.status === 'APPROVED' ? 'default' : 'secondary'}
            className={
              submission.status === 'PENDING'
                ? 'border-highlight/30 bg-highlight/15 text-foreground'
                : submission.status === 'REJECTED'
                  ? 'border-destructive/20 bg-destructive/10 text-destructive'
                  : undefined
            }
          >
            {submissionLabels[submission.status]}
          </Badge>
          <Badge variant="secondary">
            {submission.snapshot.platform === 'maibot' ? 'MaiBot' : 'AstrBot'}
          </Badge>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-7">{submission.changelog}</p>
      </EditorSection>
      <Tabs defaultValue="snapshot" className="gap-5">
        <TabsList>
          <TabsTrigger value="snapshot">提交内容</TabsTrigger>
          <TabsTrigger value="diff">版本差异</TabsTrigger>
          <TabsTrigger value="records">审核记录</TabsTrigger>
        </TabsList>
        <TabsContent value="snapshot" className="flex flex-col gap-5">
          <SnapshotView snapshot={submission.snapshot} imageBase="/api/v1/moderation/assets" />
          {evidenceAssetIds.length > 0 && (
            <EditorSection
              title="私有授权证据"
              description="仅作者与有权审核人员可访问，公开版本和导出包不含这些材料"
            >
              <div className="grid grid-cols-2 gap-3">
                {evidenceAssetIds.map((asset) => (
                  <a
                    key={asset}
                    href={'/api/v1/moderation/assets/' + asset}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Image
                      src={'/api/v1/moderation/assets/' + asset}
                      width={400}
                      height={300}
                      unoptimized
                      alt="授权证据"
                      className="h-auto max-w-full rounded-xl"
                    />
                  </a>
                ))}
              </div>
            </EditorSection>
          )}
        </TabsContent>
        <TabsContent value="diff">
          <SnapshotDiff previous={previous} next={submission.snapshot} />
        </TabsContent>
        <TabsContent value="records">
          <EditorSection title="审核与操作记录" description="保留操作者、时间、理由及自审标记">
            {records.map((record) => (
              <div key={record.id} className="flex flex-col gap-2 border-b pb-4 text-sm">
                <p>
                  {record.actor} · {record.action}
                  {record.selfReview ? ' · 管理员自审' : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(record.createdAt).toLocaleString('zh-CN')}
                </p>
                <p className="whitespace-pre-wrap">{record.reason}</p>
              </div>
            ))}
          </EditorSection>
        </TabsContent>
      </Tabs>
      {submission.status === 'PENDING' && (
        <EditorSection title="审核决定" description="审批会同时更新公开版本、审计记录与邮件通知">
          <form
            onSubmit={form.handleSubmit(() => mutation.mutate())}
            className="flex flex-col gap-5"
            noValidate
          >
            <FieldGroup>
              <FieldSet>
                <FieldLegend id="decision-label">处理结果</FieldLegend>
                <ToggleGroup
                  aria-labelledby="decision-label"
                  value={[decision]}
                  variant="outline"
                  onValueChange={(values) => {
                    if (values[0] === 'approve' || values[0] === 'reject')
                      form.setValue('action', values[0]);
                  }}
                >
                  <ToggleGroupItem value="approve">通过并发布</ToggleGroupItem>
                  <ToggleGroupItem value="reject">驳回修改</ToggleGroupItem>
                </ToggleGroup>
              </FieldSet>
              <Field>
                <FieldLabel htmlFor="review-reason">
                  审核意见{decision === 'reject' ? '（必填）' : ''}
                </FieldLabel>
                <Textarea id="review-reason" {...form.register('reason')} />
                <FieldError>{form.formState.errors.reason?.message}</FieldError>
              </Field>
              {reviewingOwnWork && viewer?.role === 'admin' && (
                <Field orientation="horizontal">
                  <Checkbox
                    id="self-review"
                    checked={selfConfirmed}
                    onCheckedChange={(v) => form.setValue('selfReviewConfirmed', v === true)}
                  />
                  <FieldLabel htmlFor="self-review" className="text-sm leading-6">
                    若为本人作品，我确认以管理员身份自审，并已填写明确理由
                  </FieldLabel>
                </Field>
              )}
              <FormNotice
                error={reviewerOwnWork ? '审核员不能审核自己的作品' : mutation.error}
                message={mutation.isSuccess ? '审核决定已保存' : undefined}
              />
              <SubmitButton pending={mutation.isPending} disabled={reviewerOwnWork}>
                {decision === 'approve' ? '通过并发布' : '驳回并通知作者'}
              </SubmitButton>
            </FieldGroup>
          </form>
        </EditorSection>
      )}
      {viewer?.role === 'admin' && (
        <EditorSection
          title="管理员处置"
          description="作品封禁与作者隐藏分别记录，解除封禁不会替作者恢复隐藏状态"
        >
          <div className="flex flex-wrap gap-3">
            <PersonaModerationActions
              id={submission.personaId}
              accountId={viewer.id}
              onSuccess={refresh}
            />
            {submission.status === 'APPROVED' && (
              <>
                {submission.releaseLifecycle === 'PUBLISHED' && (
                  <ReasonAction
                    label="屏蔽此版本"
                    description="此版本不可访问，若是当前版本则清空公开指针"
                    action={(reason) =>
                      releasesApi.state(submission.personaId, submission.releaseId, 'block', reason)
                    }
                    onSuccess={refresh}
                    destructive
                  />
                )}
                {submission.releaseLifecycle === 'BLOCKED' && (
                  <ReasonAction
                    label="解除版本屏蔽"
                    description="只恢复版本资格，不自动更改当前公开指针，已撤销的版本不可恢复"
                    action={(reason) =>
                      releasesApi.state(
                        submission.personaId,
                        submission.releaseId,
                        'restore',
                        reason,
                      )
                    }
                    onSuccess={refresh}
                  />
                )}
              </>
            )}
          </div>
        </EditorSection>
      )}
    </div>
  );
}
export function ReviewWorkspace() {
  const params = useSearchParams();
  const raw = params.get('status');
  const status = raw === 'APPROVED' || raw === 'REJECTED' || raw === 'WITHDRAWN' ? raw : 'PENDING';
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 500 ? rawPage : 1;
  const queue = useQuery({
    queryKey: ['private', 'reviews', status, page],
    queryFn: () => releasesApi.queue(status, page),
    retry: false,
  });
  const auth = useQuery(authQuery);
  const selected = params.get('submission') ?? queue.data?.data[0]?.id;
  if (auth.data && !['admin', 'moderator'].includes(auth.data.data.account?.role ?? ''))
    return <FormNotice error="此页面需要审核权限" />;
  return (
    <div className="flex flex-col gap-7">
      <PageIntro
        eyebrow="内容管理 / 审核工作台"
        title="让好作品安心与大家见面"
        description="逐份核对作品内容、来源与授权，审核决定会留下完整记录"
      />
      <nav
        aria-label="审核状态"
        className="grid grid-cols-4 gap-2 rounded-xl border bg-card p-1.5 sm:flex sm:w-fit"
      >
        {Object.entries(submissionLabels).map(([key, label]) => (
          <Link
            key={key}
            href={'?status=' + key}
            aria-current={key === status ? 'page' : undefined}
            className={buttonVariants({
              variant: key === status ? 'default' : 'ghost',
              className: 'px-2 sm:px-4',
            })}
          >
            {label}
          </Link>
        ))}
      </nav>
      {queue.isPending ? (
        <p role="status">正在读取审核队列…</p>
      ) : queue.isError ? (
        <div className="flex flex-col gap-4">
          <FormNotice error={queue.error} />
          <Button onClick={() => void queue.refetch()}>重试审核队列</Button>
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside
            className={
              (params.has('submission') ? 'hidden lg:flex ' : 'flex ') +
              'min-w-0 flex-col gap-4 lg:sticky lg:top-28'
            }
          >
            {queue.data.data.length === 0 && (
              <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
                这个分组暂时没有提交
              </p>
            )}
            {queue.data.data.map((item) => (
              <Link
                key={item.id}
                href={'?status=' + status + '&page=' + page + '&submission=' + item.id}
                className={
                  'flex flex-col gap-2 rounded-xl border bg-card p-5 shadow-panel ' +
                  (selected === item.id ? 'border-primary ring-1 ring-primary' : '')
                }
              >
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">v{item.version}</Badge>
                  <Badge variant="outline">
                    {item.snapshot.platform === 'maibot' ? 'MaiBot' : 'AstrBot'}
                  </Badge>
                </div>
                <h2 className="break-words font-medium">{item.snapshot.title}</h2>
                <p className="break-words text-sm text-muted-foreground">
                  {item.publication.publisher}
                </p>
              </Link>
            ))}
            <nav aria-label="审核分页" className="flex justify-between text-sm">
              {page > 1 ? (
                <Link href={'?status=' + status + '&page=' + (page - 1)} className="underline">
                  上一页
                </Link>
              ) : (
                <span />
              )}
              {queue.data.data.length === 20 && (
                <Link href={'?status=' + status + '&page=' + (page + 1)} className="underline">
                  下一页
                </Link>
              )}
            </nav>
          </aside>
          <section className={(params.has('submission') ? '' : 'hidden lg:block ') + 'min-w-0'}>
            {params.has('submission') && (
              <Link
                href={'?status=' + status + '&page=' + page}
                className={buttonVariants({ variant: 'outline', className: 'mb-5 lg:hidden' })}
              >
                <ArrowLeftIcon aria-hidden />
                返回审核队列
              </Link>
            )}
            {selected ? (
              <ReviewDetail key={selected} id={selected} refreshed={() => void queue.refetch()} />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">选择一份提交查看详情</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
