'use client';
import { useQuery } from '@tanstack/react-query';
import type { MarketImportPreview } from '@personamarket/contracts';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
import { Badge } from '@personamarket/ui/components/badge';
import { Button } from '@personamarket/ui/components/button';
import { marketImportsApi } from '@/lib/market-imports-api';
import { EditorSection } from './editor-section';
import { PersonaContent, redistributionLabels } from './snapshot-view';
import { SafeMarkdown } from './safe-markdown';
import { MarketImportImages, importImagesKey } from './market-import-images';
import { FormNotice } from '../auth/auth-fields';
import { ImportEncodingSummary } from './import-encoding';

export function MarketImportReview({
  preview,
  active,
  onContinue,
}: {
  preview: MarketImportPreview;
  active: boolean;
  onContinue: (images: MarketImportPreview['images']) => void;
}) {
  const images = useQuery({
    queryKey: importImagesKey(preview.id),
    queryFn: ({ signal }) => marketImportsApi.images(preview.id, signal),
    initialData: { data: preview.images },
    enabled: active,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.data.some(
        (image) => image.status === 'queued' || image.status === 'processing',
      )
        ? 1000
        : false,
  });
  const allReady = images.data.data.every((image) => image.status === 'ready');
  return (
    <div className="min-w-0 space-y-5">
      <EditorSection title="核对导入内容" description="这些内容来自文件，确认后才会保存为私有草稿">
        <ImportEncodingSummary value={preview.sourceEncoding} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {preview.draft.platform === 'maibot' ? 'MaiBot' : 'AstrBot'}
          </Badge>
          <Badge variant="outline">
            {preview.format === 'market-zip' ? '完整 ZIP 包' : '通用 JSON'}
          </Badge>
        </div>
        <h3 className="break-words text-xl font-semibold">{preview.draft.title || '未命名角色'}</h3>
        {preview.draft.summary && (
          <p className="break-words text-base leading-7 text-muted-foreground">
            {preview.draft.summary}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {preview.categoryName && (
            <Badge
              variant="secondary"
              className="h-auto min-h-5 max-w-full whitespace-normal break-all leading-6"
            >
              {preview.categoryName}
            </Badge>
          )}
          {preview.tagNames.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="h-auto min-h-5 max-w-full whitespace-normal break-all leading-6"
            >
              {tag}
            </Badge>
          ))}
        </div>
        <div role="note" aria-label="导入提示" className="rounded-xl bg-accent/60 p-4">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      </EditorSection>
      <Tabs defaultValue="content" className="min-w-0 gap-4">
        <TabsList className="group-data-horizontal/tabs:h-auto min-h-11 max-w-full flex-wrap">
          <TabsTrigger value="content" className="min-h-11 px-4">
            人设正文
          </TabsTrigger>
          {preview.draft.readmeMarkdown && (
            <TabsTrigger value="readme" className="min-h-11 px-4">
              README
            </TabsTrigger>
          )}
          <TabsTrigger value="source" className="min-h-11 px-4">
            来源与模型
          </TabsTrigger>
        </TabsList>
        <TabsContent value="content" keepMounted>
          <PersonaContent snapshot={preview.draft} />
        </TabsContent>
        {preview.draft.readmeMarkdown && (
          <TabsContent value="readme" keepMounted>
            <EditorSection title="作品介绍" description="保留文件中的 README 与图片引用">
              {allReady ? (
                <SafeMarkdown
                  text={preview.draft.readmeMarkdown}
                  imageBase={`/api/v1/me/market-imports/${preview.id}/images`}
                />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    图片托管完成后可预览完整图文，当前保留原始 Markdown
                  </p>
                  <pre className="whitespace-pre-wrap break-words text-base leading-7">
                    {preview.draft.readmeMarkdown}
                  </pre>
                </>
              )}
            </EditorSection>
          </TabsContent>
        )}
        <TabsContent value="source" keepMounted>
          <EditorSection title="文件中的来源声明" description="这些信息来自文件，仍需本人核实">
            <dl className="grid gap-4 text-base leading-7 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">来源类型</dt>
                <dd>
                  {preview.declaredOrigin.type === 'original' ? '源文件声明原创' : '源文件声明转载'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">转载规则</dt>
                <dd>{redistributionLabels[preview.declaredOrigin.redistribution]}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">原作者 / 源发布者</dt>
                <dd className="break-words">
                  {preview.declaredOrigin.type === 'repost'
                    ? preview.declaredOrigin.originalAuthor || '未注明'
                    : preview.source?.publisherName || '未注明'}
                </dd>
              </div>
              {preview.source?.version && (
                <div>
                  <dt className="text-sm text-muted-foreground">源版本</dt>
                  <dd className="break-all">{preview.source.version}</dd>
                </div>
              )}
              {preview.draft.origin.type === 'repost' && preview.draft.origin.sourceUrl && (
                <div className="sm:col-span-2">
                  <dt className="text-sm text-muted-foreground">原始来源地址</dt>
                  <dd className="break-all">{preview.draft.origin.sourceUrl}</dd>
                </div>
              )}
            </dl>
            {preview.draft.origin.type === 'repost' && preview.draft.origin.sourceDescription && (
              <div>
                <h3 className="mb-2 font-semibold">原始来源说明</h3>
                <p className="whitespace-pre-wrap break-words text-base leading-7">
                  {preview.draft.origin.sourceDescription}
                </p>
              </div>
            )}
            {preview.declaredOrigin.type === 'repost' &&
              preview.declaredOrigin.authorizationStatement && (
                <div>
                  <h3 className="mb-2 font-semibold">源文件中的转载依据</h3>
                  <p className="whitespace-pre-wrap break-words text-base leading-7">
                    {preview.declaredOrigin.authorizationStatement}
                  </p>
                </div>
              )}
            {preview.draft.authorNotes && (
              <div>
                <h3 className="mb-2 font-semibold">作者补充说明</h3>
                <p className="whitespace-pre-wrap break-words text-base leading-7">
                  {preview.draft.authorNotes}
                </p>
              </div>
            )}
            {preview.declaredOrigin.policyText && (
              <p className="whitespace-pre-wrap break-words rounded-xl border p-4 text-base leading-7">
                {preview.declaredOrigin.policyText}
              </p>
            )}
            {preview.draft.recommendedModels.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold">推荐模型</h3>
                {preview.draft.recommendedModels.map((model, index) => (
                  <div key={index} className="rounded-xl border p-3">
                    <p className="break-all text-base font-medium">
                      {model.modelId || '未命名模型'}
                    </p>
                    {model.note && (
                      <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">
                        {model.note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </EditorSection>
        </TabsContent>
      </Tabs>
      <EditorSection title="核对图片" description="确认源图片并托管到当前私有预览">
        <MarketImportImages id={preview.id} images={images.data.data} />
        <FormNotice error={images.error} />
        {images.isError && (
          <Button variant="outline" onClick={() => void images.refetch()}>
            重试读取图片状态
          </Button>
        )}
      </EditorSection>
      <div className="flex flex-col items-start gap-3 border-t pt-5">
        <Button
          type="button"
          disabled={!allReady || images.isError}
          onClick={() => onContinue(images.data.data)}
        >
          确认内容，下一步
        </Button>
        {!allReady && (
          <p className="text-sm leading-6 text-muted-foreground">
            请先完成图片托管，图片较多时可使用完整 ZIP 一次导入
          </p>
        )}
      </div>
    </div>
  );
}
