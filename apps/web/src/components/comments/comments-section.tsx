'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareIcon } from 'lucide-react';
import type { PublicComment } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@personamarket/ui/components/card';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from '@personamarket/ui/components/empty';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@personamarket/ui/components/select';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { authQuery } from '@/lib/auth-api';
import { commentsApi, commentsKey, ownCommentsKey } from '@/lib/comments-api';
import { commentPage } from '@/lib/comments-state';
import { FormNotice } from '../auth/auth-fields';
import { CommentComposer, CommentReplyEditor, type CommentAccess } from './comment-composer';
import { CommentManage } from './comment-manage';
import { CommentOwnList } from './comment-own-list';
import { CommentPagination } from './comment-pagination';
import { CommentThread } from './comment-thread';

const subscribe = () => () => {};
type ReplyTarget = {
  rootId: string;
  target: Extract<PublicComment, { status: 'published' }>;
  accountId: string;
};
export function CommentsSection({
  personaId,
  releaseId,
  version,
}: {
  personaId: string;
  releaseId: string;
  version: string;
}) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const auth = useQuery(authQuery);
  const account = hydrated ? auth.data?.data.account : undefined;
  const authenticated = auth.data?.data.assurance === 'authenticated';
  const [previousAccount, setPreviousAccount] = useState<string>();
  const [reply, setReply] = useState<ReplyTarget>();
  const [manage, setManage] = useState<{ id: string; accountId: string }>();
  const [notice, setNotice] = useState<string>();
  if (account?.id && previousAccount !== account.id) setPreviousAccount(account.id);
  const actorId = account?.id ?? previousAccount;
  const access: CommentAccess =
    !hydrated || auth.isPending
      ? 'loading'
      : auth.isError
        ? 'error'
        : !account
          ? 'guest'
          : !authenticated
            ? 'mfa'
            : !account.emailVerified
              ? 'unverified'
              : 'ready';
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const client = useQueryClient();
  const page = commentPage(search.get('commentsPage'));
  const sort = search.get('commentsSort') === 'newest' ? 'newest' : 'oldest';
  const policy = useQuery({
    queryKey: [...commentsKey(personaId), 'list', 1, 'oldest'],
    queryFn: ({ signal }) =>
      commentsApi.public(personaId, { page: 1, pageSize: 20, sort: 'oldest' }, signal),
    enabled: hydrated,
    retry: false,
  });
  const query = useQuery({
    queryKey: [...commentsKey(personaId), 'list', page, sort],
    queryFn: ({ signal }) => commentsApi.public(personaId, { page, pageSize: 20, sort }, signal),
    enabled: hydrated,
    retry: false,
  });
  const settings = policy.data?.settings;
  async function changed() {
    await Promise.all([
      client.invalidateQueries({ queryKey: commentsKey(personaId) }),
      ...(actorId
        ? [client.invalidateQueries({ queryKey: ownCommentsKey(actorId, personaId) })]
        : []),
    ]);
    setNotice('评论状态已更新');
  }
  function update(values: Record<string, string | undefined>) {
    const next = new URLSearchParams(search);
    for (const [name, value] of Object.entries(values)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    router.push(pathname + (next.size ? '?' + next : '') + '#comments', { scroll: false });
  }
  function onManage(id: string) {
    if (account && authenticated) setManage({ id, accountId: account.id });
  }
  if (!hydrated)
    return (
      <section id="comments" className="flex min-w-0 flex-col gap-5">
        <h2 className="font-heading text-2xl font-semibold">作品评论</h2>
        <Skeleton className="h-64 w-full" />
      </section>
    );
  return (
    <section
      id="comments"
      className="flex min-w-0 scroll-mt-28 flex-col gap-5"
      aria-labelledby="comments-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="comments-title" className="font-heading text-2xl font-semibold">
            作品评论
          </h2>
          {query.data && (
            <Badge variant="secondary">{query.data.meta.publishedCount} 条公开评论</Badge>
          )}
        </div>
        {account && authenticated && ['admin', 'moderator'].includes(account.role) && (
          <Button
            variant="outline"
            render={<Link href={'/admin/comments?personaId=' + personaId} />}
          >
            评论审核
          </Button>
        )}
        <Button variant="outline" render={<a href="#comment-composer" />}>
          写评论
        </Button>
      </div>
      <FormNotice message={notice} />
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>
              <h3>一起交流使用体验</h3>
            </CardTitle>
            <CardDescription>评论关联整个人设，版本更新后仍保留原有讨论</CardDescription>
            <Select
              items={[
                { value: 'oldest', label: '较早评论优先' },
                { value: 'newest', label: '最新评论优先' },
              ]}
              value={sort}
              onValueChange={(value) => {
                if (value === 'oldest' || value === 'newest')
                  update({
                    commentsSort: value === 'oldest' ? undefined : value,
                    commentsPage: undefined,
                    replyThread: undefined,
                    repliesPage: undefined,
                  });
              }}
            >
              <SelectTrigger aria-label="评论排序" className="w-full sm:w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="oldest">较早评论优先</SelectItem>
                  <SelectItem value="newest">最新评论优先</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            {(!hydrated || query.isPending) && <Skeleton className="h-36 w-full" />}
            <FormNotice error={query.error} />
            {query.isError && (
              <Button variant="outline" onClick={() => void query.refetch()}>
                重新读取评论
              </Button>
            )}
            {query.data?.data.length === 0 && (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MessageSquareIcon aria-hidden />
                  </EmptyMedia>
                  <EmptyTitle>
                    {query.data.settings.showExistingComments
                      ? '还没有公开评论'
                      : '站点暂未展示历史评论'}
                  </EmptyTitle>
                  <EmptyDescription>
                    {query.data.settings.showExistingComments
                      ? '分享你的体验，待审内容只会出现在本人的评论列表中'
                      : '评论与审核记录会保留，公开展示由管理员单独控制'}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {query.data?.data.map((root) => (
              <CommentThread
                key={root.id}
                root={root}
                personaId={personaId}
                accountId={account && authenticated ? account.id : undefined}
                canReply={access === 'ready' && Boolean(settings?.commentsEnabled)}
                opened={search.get('replyThread') === root.id}
                page={commentPage(search.get('repliesPage'))}
                onToggle={() =>
                  update({
                    replyThread: search.get('replyThread') === root.id ? undefined : root.id,
                    repliesPage: undefined,
                  })
                }
                onReply={(rootId, target) => {
                  if (account && access === 'ready')
                    setReply({ rootId, target, accountId: account.id });
                }}
                onManage={onManage}
              />
            ))}
            {query.data && (
              <CommentPagination
                page={page}
                pageSize={query.data.meta.pageSize}
                total={query.data.meta.total}
                parameter="commentsPage"
                label="公开评论分页"
                pending={query.isFetching}
              />
            )}
          </CardContent>
        </Card>
        <div className="flex min-w-0 flex-col gap-5">
          <FormNotice error={policy.error} />
          {policy.isError && (
            <Button variant="outline" onClick={() => void policy.refetch()}>
              重新读取评论设置
            </Button>
          )}
          {settings ? (
            <CommentComposer
              personaId={personaId}
              releaseId={releaseId}
              version={version}
              actorId={actorId}
              access={policy.isError ? 'error' : access}
              settings={settings}
              onChanged={changed}
            />
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
          {account && authenticated && (
            <CommentOwnList
              key={account.id}
              personaId={personaId}
              accountId={account.id}
              onManage={onManage}
            />
          )}
          {auth.isError && (
            <Button variant="outline" onClick={() => void auth.refetch()}>
              重新确认登录状态
            </Button>
          )}
        </div>
      </div>
      {manage && settings && (!account || manage.accountId === account.id) && (
        <CommentManage
          key={manage.accountId + ':' + manage.id}
          id={manage.id}
          accountId={manage.accountId}
          personaId={personaId}
          maxLength={settings.commentMaxLength}
          enabled={settings.commentsEnabled}
          onClose={() => setManage(undefined)}
          onChanged={changed}
        />
      )}
      {reply && settings && (!account || reply.accountId === account.id) && (
        <CommentReplyEditor
          key={reply.accountId + ':' + reply.target.id}
          target={reply.target}
          rootId={reply.rootId}
          personaId={personaId}
          releaseId={releaseId}
          accountId={reply.accountId}
          access={access}
          settings={settings}
          onClose={() => setReply(undefined)}
          onChanged={changed}
        />
      )}
    </section>
  );
}
