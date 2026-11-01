'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AdminUserReviewRecordsQuerySchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { adminUsersApi, adminUsersKey } from '@/lib/admin-users-api';
import { FormNotice } from '../auth/auth-fields';
import { AdminUserChoice } from './admin-user-fields';
import { useUserContentLocation, UserContentPagination } from './admin-user-content-navigation';

const actions: Record<string, string> = {
  submitted: '提交版本',
  approved: '审核通过',
  rejected: '审核驳回',
  submission_withdrawn: '撤回提交',
  restored_to_draft: '恢复到草稿',
  persona_blocked: '下架作品',
  persona_unblocked: '恢复作品',
  public_version_selected: '切换公开版本',
  owner_hidden: '作者隐藏',
  owner_listed: '作者恢复展示',
  approve: '审核通过',
  reject: '审核驳回',
  auto_approve: '按策略自动通过',
  hide: '隐藏评论',
  restore: '恢复评论',
  delete: '删除评论',
};

export function AdminUserReviewRecords({ accountId, id }: { accountId: string; id: string }) {
  const { search, update } = useUserContentLocation();
  const parsed = AdminUserReviewRecordsQuerySchema.safeParse({
    page: search.get('recordPage') ?? 1,
    pageSize: 20,
    kind: search.get('recordKind') ?? 'all',
  });
  const input = parsed.success ? parsed.data : undefined;
  const query = useQuery({
    queryKey: [...adminUsersKey(accountId), 'review-records', id, input ?? search.toString()],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('记录筛选条件无效');
      return adminUsersApi.reviewRecords(accountId, id, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  return (
    <section aria-label="用户审核与处置记录" className="flex min-w-0 flex-col gap-4">
      <h2 className="text-lg font-semibold">审核与处置记录</h2>
      <p className="text-sm text-muted-foreground">
        查阅本人作品和本人评论的真实审核及状态操作，正文在对应详情中读取
      </p>
      {!input ? (
        <>
          <FormNotice error="记录筛选或页码无效，请重置后再试" />
          <Button variant="outline" onClick={() => update({ recordPage: null, recordKind: null })}>
            重置记录筛选
          </Button>
        </>
      ) : (
        <>
          <AdminUserChoice
            id="admin-user-record-kind"
            label="审核记录类别"
            value={input.kind}
            options={[
              { value: 'all', label: '全部记录' },
              { value: 'persona', label: '作品记录' },
              { value: 'comment', label: '评论记录' },
            ]}
            onChange={(kind) => {
              const value = AdminUserReviewRecordsQuerySchema.shape.kind.safeParse(kind);
              if (value.success)
                update({ recordKind: value.data === 'all' ? null : value.data, recordPage: null });
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isError ? '重试审核记录' : query.isFetching ? '正在读取…' : '刷新审核记录'}
          </Button>
          <FormNotice error={query.error} />
          {query.isPending && (
            <>
              <p role="status">正在读取审核记录…</p>
              <Skeleton className="h-48 w-full" />
            </>
          )}
          {query.data && (
            <>
              <p className="text-sm text-muted-foreground">共 {query.data.meta.total} 条记录</p>
              {query.data.data.length ? (
                <ol className="flex min-w-0 flex-col gap-5">
                  {query.data.data.map((record) => (
                    <li
                      key={record.kind + ':' + record.id}
                      className="flex min-w-0 flex-col gap-3 rounded-xl border p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {record.kind === 'persona' ? '作品' : '评论'}
                        </Badge>
                        <h3 className="font-medium">{actions[record.action] ?? record.action}</h3>
                      </div>
                      <p className="break-words text-sm text-muted-foreground">
                        {record.actor?.username ?? '系统'}
                        {record.selfReview ? ' · 管理员自审' : ''} ·{' '}
                        <time dateTime={record.createdAt}>
                          {new Date(record.createdAt).toLocaleString('zh-CN')}
                        </time>
                      </p>
                      {record.reason ? (
                        <p
                          className="max-h-[45dvh] overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]"
                          tabIndex={0}
                        >
                          {record.reason}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">未填写处理理由</p>
                      )}
                      {record.kind === 'comment' ? (
                        <Button
                          type="button"
                          variant="outline"
                          render={<Link href={'/admin/comments?commentId=' + record.commentId} />}
                        >
                          查看评论记录
                        </Button>
                      ) : record.submissionId ? (
                        <Button
                          type="button"
                          variant="outline"
                          render={
                            <Link href={'/admin/moderation?submission=' + record.submissionId} />
                          }
                        >
                          查看版本审核
                        </Button>
                      ) : (
                        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                          作品 ID：{record.personaId}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-xl border p-5 text-muted-foreground">
                  这位用户在当前类别下还没有审核或处置记录
                </p>
              )}
              <UserContentPagination
                page={input.page}
                total={query.data.meta.total}
                pending={query.isFetching}
                label="用户审核记录分页"
                onPageChange={(page) => update({ recordPage: page === 1 ? null : String(page) })}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
