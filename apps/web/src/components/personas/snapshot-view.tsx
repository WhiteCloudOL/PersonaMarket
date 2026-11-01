import Image from 'next/image';
import { SparklesIcon, BotIcon, HeartIcon, MessageCircleIcon, LeafIcon } from 'lucide-react';
import type {
  PublicSnapshotSchema,
  PersonaContent as PersonaContentData,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { Badge } from '@personamarket/ui/components/badge';
import { SnapshotTabs } from './snapshot-tabs';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@personamarket/ui/components/card';
import { SafeMarkdown } from './safe-markdown';
import { EditorSection } from './editor-section';
import { CopyPersonaButton, type CopyScope } from './public-actions';
export type Snapshot = z.infer<typeof PublicSnapshotSchema>;
export function PersonaIdentity({
  snapshot,
  imageBase = '/api/v1/public/assets',
  metadata,
  actions,
}: {
  snapshot: Snapshot;
  imageBase?: string;
  metadata?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section
      className={
        'grid overflow-hidden rounded-2xl border bg-card shadow-panel ' +
        (snapshot.coverAssetId ? 'lg:grid-cols-[minmax(0,1fr)_35%]' : '')
      }
      aria-label="人设简介"
    >
      {snapshot.coverAssetId && (
        <div className="relative order-first h-40 overflow-hidden sm:h-52 lg:order-last lg:h-auto lg:min-h-72">
          <Image
            src={imageBase + '/' + snapshot.coverAssetId}
            fill
            unoptimized
            alt=""
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 448px"
          />
        </div>
      )}
      <div className="@container/persona-identity flex min-w-0 flex-col gap-5 p-5 sm:p-7">
        <div className="flex min-w-0 flex-col items-start gap-4 @min-[17rem]/persona-identity:flex-row @min-[17rem]/persona-identity:items-center">
          {snapshot.avatarAssetId ? (
            <Image
              src={imageBase + '/' + snapshot.avatarAssetId}
              alt={snapshot.title + '的头像'}
              width={80}
              height={80}
              unoptimized
              className="size-20 shrink-0 rounded-2xl border-4 border-card object-cover shadow-sm"
            />
          ) : (
            <div className="flex size-20 shrink-0 items-center justify-center rounded-2xl border bg-accent text-primary">
              <SparklesIcon className="size-8" aria-hidden />
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className={
                  snapshot.platform === 'maibot'
                    ? 'bg-maibot-soft text-maibot'
                    : 'bg-astrbot-soft text-astrbot'
                }
              >
                {snapshot.platform === 'maibot' ? 'MaiBot 专用' : 'AstrBot 专用'}
              </Badge>
              <Badge variant="outline">
                {snapshot.origin.type === 'original' ? '原创作品' : '转载作品'}
              </Badge>
            </div>
            <h1 className="break-words text-2xl leading-snug font-bold tracking-tight sm:text-3xl">
              {snapshot.title}
            </h1>
          </div>
        </div>
        <p className="max-w-2xl break-words text-base leading-7 text-muted-foreground">
          {snapshot.summary}
        </p>
        {metadata}
        {actions && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">{actions}</div>
        )}
      </div>
    </section>
  );
}
export function PersonaContent({
  snapshot,
  copyScope,
}: {
  snapshot: PersonaContentData;
  copyScope?: CopyScope;
}) {
  const sections =
    snapshot.platform === 'maibot'
      ? [
          {
            key: 'personality' as const,
            title: '人格设定',
            text: snapshot.content.personality,
            icon: HeartIcon,
            tone: 'bg-personality-soft text-personality',
          },
          {
            key: 'replyStyle' as const,
            title: '表达风格',
            text: snapshot.content.replyStyle,
            icon: MessageCircleIcon,
            tone: 'bg-maibot-soft text-maibot',
          },
          {
            key: 'behaviorStyle' as const,
            title: '行为风格',
            text: snapshot.content.behaviorStyle,
            icon: LeafIcon,
            tone: 'bg-astrbot-soft text-astrbot',
          },
        ]
      : [
          {
            key: 'systemPrompt' as const,
            title: '人格设定',
            text: snapshot.content.systemPrompt,
            icon: SparklesIcon,
            tone: 'bg-astrbot-soft text-astrbot',
          },
        ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>
            人设结构{' '}
            <span className="font-normal text-muted-foreground">
              · {snapshot.platform === 'maibot' ? 'MaiBot' : 'AstrBot'}
            </span>
          </h2>
        </CardTitle>
        <CardDescription>
          {snapshot.platform === 'maibot'
            ? '三个独立字段，完整保留作者设定'
            : '人格设定与成对对话，保留原始顺序'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div
          className={snapshot.platform === 'maibot' ? 'grid gap-3 xl:grid-cols-3' : 'grid gap-3'}
        >
          {sections.map(({ key, title, text, icon: Icon, tone }, index) => (
            <section
              key={key}
              className={'flex min-w-0 flex-col gap-4 rounded-xl border p-4 ' + tone}
            >
              <div className="flex items-center gap-2">
                <Icon className="size-5 shrink-0" aria-hidden />
                <h3 className="font-semibold">{title}</h3>
                <span aria-hidden className="ml-auto text-xs opacity-65">
                  #0{index + 1}
                </span>
              </div>
              <p className="flex-1 whitespace-pre-wrap break-words text-base leading-7 text-foreground">
                {text}
              </p>
              {copyScope && (
                <div className="flex justify-end">
                  <CopyPersonaButton scope={copyScope} part={key} label={'复制' + title} />
                </div>
              )}
            </section>
          ))}
        </div>
        {snapshot.platform === 'astrbot' && snapshot.content.dialoguePairs.length > 0 && (
          <section className="flex flex-col gap-4" aria-label="预设对话">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold">
                预设对话{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  · {snapshot.content.dialoguePairs.length} 组
                </span>
              </h3>
              {copyScope && (
                <CopyPersonaButton scope={copyScope} part="dialogues" label="复制全部对话" />
              )}
            </div>
            {snapshot.content.dialoguePairs.map((pair, index) => (
              <div
                key={pair.id}
                className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 text-base"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h4 className="text-xs text-muted-foreground">第 {index + 1} 组</h4>
                  {copyScope && (
                    <CopyPersonaButton
                      scope={copyScope}
                      part={`pair:${pair.id}`}
                      label={'复制第 ' + (index + 1) + ' 组对话'}
                    />
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words rounded-lg bg-card p-3 leading-7">
                  用户：{pair.user}
                </p>
                <p className="whitespace-pre-wrap break-words rounded-lg bg-accent/60 p-3 leading-7">
                  AI：{pair.assistant}
                </p>
              </div>
            ))}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
export const redistributionLabels = {
  not_allowed: '不允许转载',
  attribution_required: '注明出处即可转载',
  contact_required: '转载前请联系作者',
  custom: '遵循作者自定义规则',
};
export function OriginDetails({ snapshot }: { snapshot: Snapshot }) {
  return (
    <EditorSection title="来源与转载声明" description="以下声明由发布者提供">
      <Badge variant="secondary">
        {snapshot.origin.type === 'original' ? '原创作品' : '转载作品'}
      </Badge>
      <p className="text-sm leading-7">{redistributionLabels[snapshot.origin.redistribution]}</p>
      {snapshot.origin.policyText && (
        <p className="whitespace-pre-wrap break-words text-sm leading-7">
          {snapshot.origin.policyText}
        </p>
      )}
      {snapshot.origin.type === 'repost' && (
        <>
          <p className="break-words text-sm">原作者：{snapshot.origin.originalAuthor}</p>
          {snapshot.origin.sourceUrl && (
            <a
              href={snapshot.origin.sourceUrl}
              target="_blank"
              rel="noopener noreferrer ugc"
              className="break-all text-sm text-primary underline"
            >
              查看原始来源
            </a>
          )}
          <p className="whitespace-pre-wrap break-words text-sm leading-7">
            {snapshot.origin.sourceDescription}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm leading-7">
            {snapshot.origin.authorizationStatement}
          </p>
        </>
      )}
    </EditorSection>
  );
}
export function ModelRecommendations({ snapshot }: { snapshot: Snapshot }) {
  if (!snapshot.recommendedModels.length) return null;
  return (
    <EditorSection title="推荐模型" description="作者的使用建议">
      <ModelRecommendationList snapshot={snapshot} />
    </EditorSection>
  );
}
export function ModelRecommendationList({ snapshot }: { snapshot: Snapshot }) {
  return snapshot.recommendedModels.map((model, index) => (
    <div key={index} className="flex min-w-0 gap-3">
      <BotIcon aria-hidden className="size-5 shrink-0 text-primary" />
      <div className="min-w-0 text-sm">
        <p className="break-all font-medium">{model.modelId}</p>
        <p className="break-words leading-6 text-muted-foreground">{model.note}</p>
      </div>
    </div>
  ));
}
export function SnapshotView({
  snapshot,
  imageBase = '/api/v1/public/assets',
  copyScope,
  sidebarMetadata = false,
  readmeContent,
}: {
  snapshot: Snapshot;
  imageBase?: string;
  copyScope?: CopyScope;
  sidebarMetadata?: boolean;
  readmeContent?: React.ReactNode;
}) {
  const content = <PersonaContent snapshot={snapshot} {...(copyScope ? { copyScope } : {})} />;
  return (
    <SnapshotTabs
      readme={
        snapshot.readmeMarkdown.trim() || snapshot.authorNotes?.trim() ? (
          <EditorSection
            title="关于这个人设"
            description="作者的介绍与使用说明"
            {...(readmeContent !== undefined ? { className: 'overflow-visible' } : {})}
          >
            {readmeContent ?? <SafeMarkdown text={snapshot.readmeMarkdown} imageBase={imageBase} />}
            {snapshot.authorNotes && (
              <p className="whitespace-pre-wrap break-words border-t pt-4 text-sm leading-7">
                {snapshot.authorNotes}
              </p>
            )}
          </EditorSection>
        ) : null
      }
      content={content}
      origin={<OriginDetails snapshot={snapshot} />}
      models={!sidebarMetadata && <ModelRecommendations snapshot={snapshot} />}
    />
  );
}
