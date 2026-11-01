'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  ProfileModerationQuerySchema,
  ReviewProfileSchema,
  SetProfileVisibilitySchema,
  IdSchema,
  type ModerationProfile,
  type ReviewProfile,
  type SetProfileVisibility,
  type UserRole,
} from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Badge } from '@personamarket/ui/components/badge';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { Field, FieldGroup, FieldLabel, FieldError } from '@personamarket/ui/components/field';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@personamarket/ui/components/alert-dialog';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@personamarket/ui/components/empty';
import { profilesApi, profilesKey } from '@/lib/profiles-api';
import { FormNotice } from '../auth/auth-fields';
import { announcementDate } from '../announcements/announcement-content';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { ProfileContentView, profileStatuses } from './content';
import { ProfileHistory } from './history';
import { ProfileModerationFilters } from './moderation-filters';

type Command =
  { kind: 'review'; body: ReviewProfile } | { kind: 'visibility'; body: SetProfileVisibility };
function ReviewPanel({
  accountId,
  role,
  initial,
  close,
}: {
  accountId: string;
  role: UserRole;
  initial: ModerationProfile;
  close: () => void;
}) {
  const client = useQueryClient(),
    [snapshot, setSnapshot] = useState(initial),
    [candidate, setCandidate] = useState<ModerationProfile>();
  const [confirmation, setConfirmation] = useState<Command>(),
    [notice, setNotice] = useState<string>();
  const form = useForm<z.input<typeof ReviewProfileSchema>, unknown, ReviewProfile>({
    resolver: zodResolver(ReviewProfileSchema),
    defaultValues: {
      decision: 'approve',
      expectedRevision: initial.revision,
      reason: '',
      selfReviewConfirmed: false,
    },
  });
  const nonce = useRef<{ signature: string; key: string } | undefined>(undefined);
  useUnsavedDraft(form.formState.isDirty, '资料审核意见尚未提交，确定离开吗');
  const read = useMutation({
    mutationFn: () => profilesApi.moderation(accountId, snapshot.id),
    retry: false,
    onSuccess: (result) => setCandidate(result.data),
  });
  const mutation = useMutation({
    mutationFn: async (command: Command) => {
      const signature = JSON.stringify({ id: snapshot.id, command });
      if (nonce.current?.signature !== signature)
        nonce.current = { signature, key: crypto.randomUUID() };
      if (command.kind === 'review')
        return profilesApi.review(accountId, snapshot.id, command.body, nonce.current.key);
      await profilesApi.visibility(accountId, snapshot.userId, command.body, nonce.current.key);
      return profilesApi.moderation(accountId, snapshot.id);
    },
    retry: false,
    onSuccess: (result) => {
      setSnapshot(result.data);
      setCandidate(undefined);
      setConfirmation(undefined);
      nonce.current = undefined;
      form.reset({
        ...form.getValues(),
        expectedRevision: result.data.revision,
        reason: '',
        selfReviewConfirmed: false,
      });
      setNotice('处理结果已保存');
      void client.invalidateQueries({ queryKey: [...profilesKey(accountId, true), 'list'] });
      void client.invalidateQueries({ queryKey: [...profilesKey(accountId, true), 'records'] });
    },
    onError: () => setConfirmation(undefined),
  });
  const busy = mutation.isPending || read.isPending,
    self = snapshot.userId === accountId;
  const canReview = snapshot.status === 'PENDING' && (!self || role === 'admin');
  const canManageVisibility =
    role === 'admin' && Boolean(snapshot.currentProfile.publishedSubmissionId);
  function visibility() {
    const parsed = SetProfileVisibilitySchema.safeParse({
      hidden: snapshot.currentProfile.visibility !== 'hidden',
      expectedRevision: snapshot.currentProfile.revision,
      reason: form.getValues('reason'),
      selfReviewConfirmed: form.getValues('selfReviewConfirmed'),
    });
    if (!parsed.success) {
      form.setError('reason', { message: '请填写公开资料处置理由' }, { shouldFocus: true });
      return;
    }
    setConfirmation({ kind: 'visibility', body: parsed.data });
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (
          !open &&
          !busy &&
          (!form.formState.isDirty || window.confirm('审核意见尚未提交，确定关闭吗'))
        )
          close();
      }}
    >
      <SheetContent className="sm:max-w-2xl" showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>审核公开资料</SheetTitle>
          <SheetDescription>仅批准明确快照，后续编辑不会混入本次决定</SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>{profileStatuses[snapshot.status]}</Badge>
            <p className="break-all text-sm text-muted-foreground">{snapshot.owner.username}</p>
          </div>
          <Tabs defaultValue="review" className="min-w-0 gap-5">
            <TabsList
              className="flex w-full max-w-full flex-wrap group-data-horizontal/tabs:h-auto"
              aria-label="资料审核分区"
            >
              <TabsTrigger value="review" className="min-h-11 min-w-fit flex-1">
                核对与处理
              </TabsTrigger>
              <TabsTrigger value="records" className="min-h-11 min-w-fit flex-1">
                处理记录
              </TabsTrigger>
            </TabsList>
            <TabsContent value="review" keepMounted className="flex min-w-0 flex-col gap-5">
              <ProfileContentView
                content={snapshot.snapshot}
                avatarSrc={
                  snapshot.snapshot.avatarAssetId
                    ? '/api/v1/admin/profiles/submissions/' + snapshot.id + '/avatar'
                    : null
                }
              />
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                提交于 {announcementDate(snapshot.createdAt)} · 草稿修订 {snapshot.draftRevision}
              </p>
              <FormNotice error={mutation.error ?? read.error} message={notice} />
              {mutation.isError && (
                <Button variant="outline" disabled={busy} onClick={() => read.mutate()}>
                  读取最新状态并保留意见
                </Button>
              )}
              {candidate && (
                <div className="flex flex-col gap-3 rounded-xl border p-4">
                  <p className="text-sm leading-6">
                    服务器当前为{profileStatuses[candidate.status]}，公开资料修订{' '}
                    {candidate.currentProfile.revision}，审核意见仍保留
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSnapshot(candidate);
                      form.setValue('expectedRevision', candidate.revision);
                      setCandidate(undefined);
                      mutation.reset();
                    }}
                  >
                    采用最新状态后重新核对
                  </Button>
                </div>
              )}
              {self && role !== 'admin' && (
                <p role="status" className="text-sm leading-6 text-muted-foreground">
                  本人的资料请交由其他审核员或管理员处理
                </p>
              )}
              {(canReview || canManageVisibility) && (
                <form
                  noValidate
                  onSubmit={form.handleSubmit((body) => setConfirmation({ kind: 'review', body }))}
                >
                  <FieldGroup>
                    {canReview && (
                      <Controller
                        name="decision"
                        control={form.control}
                        render={({ field }) => (
                          <ToggleGroup
                            value={[field.value]}
                            onValueChange={(values) => {
                              const next = values[0];
                              if (next === 'approve' || next === 'reject') field.onChange(next);
                            }}
                            aria-label="资料审核决定"
                            className="grid w-full grid-cols-2"
                          >
                            <ToggleGroupItem value="approve" className="min-h-11">
                              审核通过
                            </ToggleGroupItem>
                            <ToggleGroupItem value="reject" className="min-h-11">
                              退回调整
                            </ToggleGroupItem>
                          </ToggleGroup>
                        )}
                      />
                    )}
                    <Field data-invalid={Boolean(form.formState.errors.reason)}>
                      <FieldLabel htmlFor="profile-review-reason">给作者的处理说明</FieldLabel>
                      <Textarea
                        id="profile-review-reason"
                        rows={4}
                        autoComplete="off"
                        disabled={busy}
                        aria-invalid={Boolean(form.formState.errors.reason)}
                        {...form.register('reason')}
                      />
                      <FieldError errors={[form.formState.errors.reason]} />
                    </Field>
                    {self && (
                      <Controller
                        name="selfReviewConfirmed"
                        control={form.control}
                        render={({ field }) => (
                          <Field orientation="horizontal">
                            <FieldLabel className="flex min-h-11 cursor-pointer items-center gap-3">
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                disabled={busy}
                              />
                              确认这是我本人的资料并同意自审
                            </FieldLabel>
                          </Field>
                        )}
                      />
                    )}
                    {canReview && (
                      <Button type="submit" disabled={busy}>
                        核对审核操作
                      </Button>
                    )}
                    {canManageVisibility && (
                      <Button type="button" variant="outline" disabled={busy} onClick={visibility}>
                        {snapshot.currentProfile.visibility === 'hidden'
                          ? '恢复公开资料'
                          : '隐藏公开资料'}
                      </Button>
                    )}
                  </FieldGroup>
                </form>
              )}
              {snapshot.status !== 'PENDING' && snapshot.reason && (
                <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">
                  上次处理说明：{snapshot.reason}
                </p>
              )}
              <Link
                className={buttonVariants({ variant: 'ghost' })}
                href={'/users/' + snapshot.owner.username}
                target="_blank"
                rel="noopener noreferrer"
              >
                查看当前公开主页
              </Link>
            </TabsContent>
            <TabsContent value="records">
              <ProfileHistory accountId={accountId} kind="records" userId={snapshot.userId} />
            </TabsContent>
          </Tabs>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (!form.formState.isDirty || window.confirm('审核意见尚未提交，确定关闭吗'))
                close();
            }}
          >
            关闭资料审核
          </Button>
        </div>
        <AlertDialog
          open={Boolean(confirmation)}
          onOpenChange={(open) => {
            if (!open && !busy) setConfirmation(undefined);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认资料处理</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmation?.kind === 'review'
                  ? confirmation.body.decision === 'approve'
                    ? '此快照将成为获批资料，隐藏状态仍保持'
                    : '此快照将退回作者，旧获批资料保持原样'
                  : confirmation?.body.hidden
                    ? '将隐藏当前公开资料，作品按各自状态展示'
                    : '将恢复当前获批资料的公开展示'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <p className="max-h-[35dvh] overflow-y-auto whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">
              {confirmation?.body.reason || '未附加处理说明'}
            </p>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>返回核对</AlertDialogCancel>
              <Button
                disabled={busy}
                onClick={() => {
                  if (confirmation) mutation.mutate(confirmation);
                }}
              >
                {busy ? '正在处理…' : '确认执行资料处理'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

function ModerationDetail({
  accountId,
  role,
  id,
  close,
}: {
  accountId: string;
  role: UserRole;
  id: string;
  close: () => void;
}) {
  const query = useQuery({
    queryKey: [...profilesKey(accountId, true), 'detail', id],
    queryFn: ({ signal }) => profilesApi.moderation(accountId, id, signal),
    retry: false,
  });
  if (query.isPending) return <p role="status">正在读取审核快照…</p>;
  if (query.isError)
    return (
      <div className="flex flex-col gap-3">
        <FormNotice error={query.error} />
        <Button onClick={() => void query.refetch()}>重试读取审核快照</Button>
        <Button variant="outline" onClick={close}>
          关闭审核详情
        </Button>
      </div>
    );
  return (
    <ReviewPanel
      key={id}
      accountId={accountId}
      role={role}
      initial={query.data.data}
      close={close}
    />
  );
}
export function ProfileModeration({ accountId, role }: { accountId: string; role: UserRole }) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const raw = {
    status: search.get('status') ?? 'PENDING',
    username: search.get('username') ?? '',
    page: search.get('page') ?? 1,
    pageSize: 20,
  };
  const input = ProfileModerationQuerySchema.safeParse(raw),
    selected = IdSchema.safeParse(search.get('submission'));
  function navigate(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    router.push(pathname + (next.size ? '?' + next : ''), { scroll: false });
  }
  const query = useQuery({
    queryKey: [...profilesKey(accountId, true), 'list', raw],
    queryFn: ({ signal }) => {
      if (!input.success) throw Error('资料审核筛选条件无效');
      return profilesApi.moderationList(accountId, input.data, signal);
    },
    enabled: input.success,
    retry: false,
  });
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ProfileModerationFilters
        key={JSON.stringify({ status: raw.status, username: raw.username })}
        initial={{ status: raw.status, username: raw.username }}
        apply={({ username, status }) =>
          navigate({
            username: username || undefined,
            status,
            page: undefined,
            submission: undefined,
          })
        }
      />
      {!input.success ? (
        <>
          <FormNotice error="资料审核筛选条件无效，请清空后重试" />
          <Button onClick={() => router.replace(pathname)}>清空资料筛选</Button>
        </>
      ) : query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <>
          <FormNotice error={query.error} />
          <Button onClick={() => void query.refetch()}>重试读取审核队列</Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            共 {query.data?.meta.total ?? 0} 份资料
          </p>
          {query.data?.data.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  <h2>当前没有待处理资料</h2>
                </EmptyTitle>
                <EmptyDescription>新的提交到达后会出现在审核队列</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {query.data?.data.map((row) => (
                <Card key={row.id}>
                  <CardHeader>
                    <Badge variant="outline" className="self-start">
                      {profileStatuses[row.status]}
                    </Badge>
                    <CardTitle className="[overflow-wrap:anywhere]">
                      <h2>{row.snapshot.displayName}</h2>
                    </CardTitle>
                    <CardDescription className="[overflow-wrap:anywhere]">
                      {row.owner.username} · {announcementDate(row.createdAt)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      variant="outline"
                      aria-label={'审核资料：' + row.snapshot.displayName}
                      onClick={() => navigate({ submission: row.id })}
                    >
                      查看资料快照
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {query.data && query.data.meta.total > 0 && (
            <nav
              aria-label="资料审核队列分页"
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <Button
                variant="outline"
                disabled={query.data.meta.page <= 1}
                onClick={() =>
                  navigate({ page: String(query.data.meta.page - 1), submission: undefined })
                }
              >
                上一页
              </Button>
              <p className="text-sm text-muted-foreground">第 {query.data.meta.page} 页</p>
              <Button
                variant="outline"
                disabled={query.data.meta.page * 20 >= query.data.meta.total}
                onClick={() =>
                  navigate({ page: String(query.data.meta.page + 1), submission: undefined })
                }
              >
                下一页
              </Button>
            </nav>
          )}
        </>
      )}
      {selected.success && (
        <ModerationDetail
          accountId={accountId}
          role={role}
          id={selected.data}
          close={() => navigate({ submission: undefined })}
        />
      )}
    </div>
  );
}
