import Link from 'next/link';
import { DELETED_AUTHOR_LABEL } from '@personamarket/contracts';
import { ReadmeDocument } from './readme-document';
import { Suspense } from 'react';
import {
  CalendarDaysIcon,
  FileTextIcon,
  ChevronDownIcon,
  UserRoundIcon,
  ChevronRightIcon,
  MessageSquareIcon,
} from 'lucide-react';
import { readPublicPersona, readPublicHistory } from '@/lib/public-personas';
import {
  PersonaIdentity,
  SnapshotView,
  ModelRecommendationList,
  redistributionLabels,
} from './snapshot-view';
import { CopyPersonaButton, ExportPersonaButton } from './public-actions';
import { Card, CardHeader, CardTitle, CardContent } from '@personamarket/ui/components/card';
import { Badge } from '@personamarket/ui/components/badge';
import { PersonaCurationBadges } from './curation-badges';
import { Button } from '@personamarket/ui/components/button';
import { PageContainer } from '@/components/page-layout';
import { InteractionControls, InteractionProvider } from './interaction-controls';
import { ReportButton } from '../reports/report-button';
import { CommentsSection } from '../comments/comments-section';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { PublicHistorySheet, PublicHistoryLink } from './public-history-sheet';
export async function PublicDetail({ id, releaseId }: { id: string; releaseId?: string }) {
  const [item, history] = await Promise.all([
    readPublicPersona(id, releaseId),
    readPublicHistory(id),
  ]);
  const scope = { id, releaseId: item.releaseId };
  const platform = item.snapshot.platform === 'maibot' ? 'MaiBot' : 'AstrBot';
  return (
    <PageContainer>
      <nav
        aria-label="面包屑"
        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:text-sm"
      >
        <Link href="/explore" className="flex min-h-11 items-center hover:text-primary">
          探索人设
        </Link>
        <ChevronRightIcon className="size-3" aria-hidden />
        <span className="break-words">{item.snapshot.title}</span>
      </nav>
      <PersonaIdentity
        snapshot={item.snapshot}
        metadata={
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground sm:text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <UserRoundIcon className="size-4 shrink-0" aria-hidden />
              {item.publication.publisher === DELETED_AUTHOR_LABEL ? (
                <span className="flex min-h-11 items-center font-medium text-foreground">
                  {DELETED_AUTHOR_LABEL}
                </span>
              ) : (
                <Link
                  href={'/users/' + encodeURIComponent(item.publication.publisher)}
                  className="flex min-h-11 items-center break-all font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {item.publication.publisher}
                </Link>
              )}
            </span>
            <span className="flex items-center gap-2">
              <CalendarDaysIcon className="size-4" aria-hidden />
              <time dateTime={item.publishedAt}>
                {new Date(item.publishedAt).toLocaleDateString('zh-CN')}
              </time>
            </span>
            <span>v{item.version}</span>
            <Badge variant="outline">{item.current ? '当前公开版本' : '历史公开版本'}</Badge>
            <PersonaCurationBadges curation={item.curation} />
          </div>
        }
        actions={
          <>
            <CopyPersonaButton scope={scope} part="all" label="复制人设" primary />
            <ExportPersonaButton scope={scope} platform={item.snapshot.platform} />
            <CopyPersonaButton scope={scope} part="link" label="分享" />
          </>
        }
      />
      <InteractionProvider ids={[id]}>
        <div className="flex max-w-xl flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 basis-56">
            <InteractionControls personaId={id} counts={item.interactionCounts} />
          </div>
          <Button variant="outline" render={<a href="#comments" />}>
            <MessageSquareIcon aria-hidden />
            评论
          </Button>
          <ReportButton target={{ type: 'persona', personaId: id, releaseId: item.releaseId }} />
        </div>
      </InteractionProvider>
      {!item.current && (
        <p className="rounded-xl border bg-accent/50 px-5 py-3 text-sm leading-7">
          你正在查看 v{item.version}，复制与导出也会使用这个版本{' '}
          <Link href={'/personas/' + id} className="ml-2 text-primary underline">
            查看当前版本
          </Link>
        </p>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_21rem]">
        <SnapshotView
          snapshot={item.snapshot}
          copyScope={scope}
          sidebarMetadata
          readmeContent={
            <ReadmeDocument
              text={item.snapshot.readmeMarkdown}
              releaseId={item.releaseId}
              personaId={id}
            />
          }
        />
        <aside aria-label="作品资料" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-28">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileTextIcon className="size-5 text-primary" aria-hidden />
                <h2>作品信息</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <dl className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-x-3 gap-y-4 text-sm">
                <dt className="text-muted-foreground">平台</dt>
                <dd>{platform} 专用</dd>
                <dt className="text-muted-foreground">版本</dt>
                <dd>v{item.version}</dd>
                <dt className="text-muted-foreground">发布者</dt>
                <dd className="break-all">{item.publication.publisher}</dd>
                <dt className="text-muted-foreground">分类</dt>
                <dd className="break-words">{item.publication.category.name}</dd>
                <dt className="text-muted-foreground">作品来源</dt>
                <dd>{item.snapshot.origin.type === 'original' ? '原创作品' : '转载作品'}</dd>
                <dt className="text-muted-foreground">转载规则</dt>
                <dd className="break-words leading-6">
                  {redistributionLabels[item.snapshot.origin.redistribution]}
                </dd>
              </dl>
              {item.publication.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {item.publication.tags.map((tag) => (
                    <Link
                      key={tag.id}
                      href={'/explore?tagId=' + tag.id}
                      className="inline-flex min-h-11 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <Badge variant="secondary">{tag.name}</Badge>
                    </Link>
                  ))}
                </div>
              )}
              {item.snapshot.recommendedModels.length > 0 && (
                <div className="flex min-w-0 flex-col gap-2 border-t pt-4">
                  <h3 className="text-sm font-semibold">推荐模型</h3>
                  <p className="break-all text-sm leading-6">
                    {item.snapshot.recommendedModels
                      .slice(0, 3)
                      .map((model) => model.modelId)
                      .join(' / ')}
                    {item.snapshot.recommendedModels.length > 3 &&
                      ` 等 ${item.snapshot.recommendedModels.length} 个模型`}
                  </p>
                  <Collapsible className="flex min-w-0 flex-col gap-3">
                    <CollapsibleTrigger
                      render={
                        <Button
                          variant="ghost"
                          className="h-auto min-h-11 justify-between whitespace-normal"
                        />
                      }
                    >
                      查看模型建议
                      <ChevronDownIcon data-icon="inline-end" aria-hidden />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="flex min-w-0 flex-col gap-4">
                      <ModelRecommendationList snapshot={item.snapshot} />
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )}
              <p className="text-xs leading-6 text-muted-foreground">
                作品与来源声明由发布者提供，请按该版本的转载规则使用
              </p>
            </CardContent>
          </Card>
          <PublicHistorySheet key={item.releaseId}>
            <h3 className="text-sm font-semibold">v{item.version} 更新说明</h3>
            <p className="whitespace-pre-wrap break-words rounded-xl bg-muted/50 p-3 text-sm leading-7">
              {item.changelog}
            </p>
            {history ? (
              history.map((version) => (
                <PublicHistoryLink
                  key={version.releaseId}
                  href={'/personas/' + id + '/releases/' + version.releaseId}
                  aria-current={version.releaseId === item.releaseId ? 'page' : undefined}
                  className="flex min-h-11 items-center justify-between gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span>v{version.version}</span>
                  {version.current ? (
                    <Badge variant="secondary">当前版本</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {new Date(version.publishedAt).toLocaleDateString('zh-CN')}
                    </span>
                  )}
                </PublicHistoryLink>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">暂时无法读取历史版本，请刷新重试</p>
            )}
          </PublicHistorySheet>
        </aside>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <CommentsSection personaId={id} releaseId={item.releaseId} version={item.version} />
      </Suspense>
    </PageContainer>
  );
}
