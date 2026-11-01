'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Badge } from '@personamarket/ui/components/badge';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { releasesApi } from '@/lib/releases-api';
import { personasApi } from '@/lib/personas-api';
import { FormNotice } from '../auth/auth-fields';
import { EditorSection } from './editor-section';
import { SnapshotView } from './snapshot-view';
import { ReasonAction } from './reason-action';
import { RestoreDraft } from './restore-draft';
import { PendingSubmissionHint } from './pending-submission-hint';
export const submissionLabels = {
  PENDING: '待审核',
  APPROVED: '已通过',
  REJECTED: '需修改',
  WITHDRAWN: '已撤回',
} as const;
export function ReleaseManager({ id }: { id: string }) {
  const params = useSearchParams();
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 500 ? rawPage : 1;
  const list = useQuery({
    queryKey: ['private', 'releases', id, page],
    queryFn: () => releasesApi.own(id, page),
    retry: false,
  });
  const draft = useQuery({
    queryKey: ['private', 'persona', id],
    queryFn: () => personasApi.read(id),
    retry: false,
  });
  const selected =
    list.data?.data.find((item) => item.id === params.get('submission')) ?? list.data?.data[0];
  const pending = params.has('submission')
    ? selected?.status === 'PENDING'
      ? selected
      : undefined
    : list.data?.data.find((item) => item.status === 'PENDING');
  const refresh = () => {
    void list.refetch();
    void draft.refetch();
  };
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-primary">创作者工作台 / Release</p>
          <h1 className="text-3xl font-semibold">发布记录</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            每次发版都保留独立快照，继续创作不会改变审核中的内容
          </p>
        </div>
        <Link href={'/dashboard/personas/' + id + '/edit'} className={buttonVariants()}>
          继续编辑与发版
        </Link>
      </div>
      {!list.isError && !list.isFetching && pending && (
        <PendingSubmissionHint personaId={id} submissionId={pending.id} onStatusChanged={refresh} />
      )}
      {list.isPending ? (
        <p role="status">正在读取版本…</p>
      ) : list.isError ? (
        <>
          <FormNotice error={list.error.message} />
          <Button onClick={() => void list.refetch()}>重试读取版本</Button>
        </>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div
            className={
              (params.has('submission') ? 'hidden xl:flex ' : 'flex ') + 'min-w-0 flex-col gap-5'
            }
          >
            <EditorSection title="作品状态" description="作者可见性与管理员处置分别管理">
              {draft.data && (
                <>
                  <p className="text-sm">
                    展示状态：
                    {draft.data.data.ownerVisibility === 'listed' ? '正常展示' : '作者隐藏'} ·{' '}
                    {draft.data.data.moderationState === 'blocked' ? '管理员封禁' : '内容状态正常'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <ReasonAction
                      label={draft.data.data.ownerVisibility === 'listed' ? '隐藏作品' : '恢复展示'}
                      description="隐藏后所有公开版本、图片和下载入口同步受限，恢复展示仍受审核与管理员处置约束"
                      action={(reason) =>
                        releasesApi.visibility(
                          id,
                          draft.data.data.ownerVisibility === 'listed' ? 'hidden' : 'listed',
                          reason,
                        )
                      }
                      onSuccess={refresh}
                    />
                    {list.data.data.some(
                      (item) => item.current && item.releaseLifecycle === 'PUBLISHED',
                    ) && (
                      <Link
                        href={'/personas/' + id}
                        className={buttonVariants({ variant: 'ghost' })}
                      >
                        查看公开页面
                      </Link>
                    )}
                  </div>
                </>
              )}
              {draft.error && <FormNotice error={draft.error.message} />}
            </EditorSection>
            {list.data.data.length === 0 && (
              <EditorSection
                title="为角色准备第一个版本"
                description="在编辑器补齐信息后，主动创建 Release 提交审核"
              >
                <Link
                  href={'/dashboard/personas/' + id + '/edit'}
                  className="text-primary underline"
                >
                  返回创作
                </Link>
              </EditorSection>
            )}
            {list.data.data.map((item) => (
              <EditorSection
                key={item.id}
                title={'v' + item.version}
                description={
                  '第 ' +
                  item.attemptNumber +
                  ' 次提交 · ' +
                  new Date(item.createdAt).toLocaleDateString('zh-CN')
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={item.status === 'APPROVED' ? 'default' : 'secondary'}
                    className={
                      item.status === 'PENDING'
                        ? 'border-highlight/30 bg-highlight/15 text-foreground'
                        : item.status === 'REJECTED'
                          ? 'border-destructive/20 bg-destructive/10 text-destructive'
                          : undefined
                    }
                  >
                    {submissionLabels[item.status]}
                  </Badge>
                  <Link
                    href={'?page=' + page + '&submission=' + item.id}
                    className="text-sm text-primary underline"
                  >
                    查看快照
                  </Link>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-7">{item.changelog}</p>
                {item.reason && (
                  <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">
                    审核或操作意见：{item.reason}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {item.status === 'PENDING' && (
                    <ReasonAction
                      label="撤回审核"
                      description="撤回后这次快照保留记录，可以继续修改草稿后重新提交"
                      action={(reason) => releasesApi.withdraw(item.id, item.revision, reason)}
                      onSuccess={refresh}
                      destructive
                    />
                  )}
                  {draft.data && <RestoreDraft submission={item} onSuccess={refresh} />}
                  {item.status === 'APPROVED' && item.releaseLifecycle === 'PUBLISHED' && (
                    <>
                      {!item.current && (
                        <ReasonAction
                          label="设为当前公开版本"
                          description="切换当前指针，版本正文和历史最高版本号保持不变"
                          action={(reason) => releasesApi.rollback(id, item.releaseId, reason)}
                          onSuccess={refresh}
                        />
                      )}
                      <ReasonAction
                        label="撤销已发布版本"
                        description="此版本将无法访问，当前指针失效时不会自动切回旧版本"
                        action={(reason) =>
                          releasesApi.state(id, item.releaseId, 'withdraw', reason)
                        }
                        onSuccess={refresh}
                        destructive
                      />
                    </>
                  )}
                </div>
              </EditorSection>
            ))}
            <nav aria-label="版本分页" className="flex justify-between">
              {page > 1 ? (
                <Link href={'?page=' + (page - 1)} className="underline">
                  上一页
                </Link>
              ) : (
                <span />
              )}
              {list.data.data.length === 20 && (
                <Link href={'?page=' + (page + 1)} className="underline">
                  下一页
                </Link>
              )}
            </nav>
          </div>
          <aside
            className={
              (params.has('submission') ? 'flex ' : 'hidden xl:flex ') +
              'min-w-0 flex-col gap-5 xl:sticky xl:top-28'
            }
          >
            {selected && (
              <>
                <Link
                  href={'?page=' + page}
                  className={buttonVariants({ variant: 'outline', className: 'xl:hidden' })}
                >
                  返回版本列表
                </Link>
                <div className="rounded-xl border bg-card p-5">
                  <h2 className="text-lg font-semibold">v{selected.version} 的审核快照</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {selected.snapshot.title} · {submissionLabels[selected.status]}
                  </p>
                </div>
                <SnapshotView snapshot={selected.snapshot} imageBase="/api/v1/me/assets" />
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
