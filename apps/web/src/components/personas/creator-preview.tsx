'use client';
import { useFormContext, useWatch } from 'react-hook-form';
import { useDeferredValue, useMemo, type ReactNode } from 'react';
import Image from 'next/image';
import { SparklesIcon } from 'lucide-react';
import type { PersonaDraft, ContentLimits } from '@personamarket/contracts';
import { Badge } from '@personamarket/ui/components/badge';
import { EditorSection } from './editor-section';
import { SafeMarkdown } from './safe-markdown';
import { DraftChecks } from './draft-checks';
export function CreatorCard() {
  const form = useFormContext<PersonaDraft>();
  const value = useWatch({ control: form.control });
  const readme = useDeferredValue(value.readmeMarkdown || '写下角色的故事、适用场景与使用建议');
  const story = useMemo(() => <SafeMarkdown text={readme} />, [readme]);
  return (
    <EditorSection title="实时预览" description="看看读者将如何认识你的角色">
      {value.coverAssetId && (
        <Image
          src={'/api/v1/me/assets/' + value.coverAssetId}
          alt="预览封面"
          width={500}
          height={240}
          unoptimized
          className="h-36 w-full rounded-xl object-cover"
        />
      )}
      <div className="flex items-center gap-3">
        {value.avatarAssetId ? (
          <Image
            src={'/api/v1/me/assets/' + value.avatarAssetId}
            alt="预览头像"
            width={56}
            height={56}
            unoptimized
            className="size-14 rounded-xl object-cover"
          />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
            <SparklesIcon aria-hidden />
          </div>
        )}
        <div className="min-w-0">
          <Badge variant="secondary">{value.platform === 'maibot' ? 'MaiBot' : 'AstrBot'}</Badge>
          <h2 className="mt-2 break-words font-semibold">
            {value.title?.trim() || '你的角色名称'}
          </h2>
        </div>
      </div>
      <p className="break-words text-sm leading-7 text-muted-foreground">
        {value.summary?.trim() || '用一句话介绍这个角色'}
      </p>
      <div
        className="max-h-60 overflow-y-auto border-t pt-4"
        tabIndex={0}
        aria-label="作品介绍预览"
      >
        {story}
      </div>
    </EditorSection>
  );
}
export function DraftSavingHelp() {
  return (
    <>
      <h3 className="text-sm font-medium">创作提示</h3>
      <p className="text-sm text-muted-foreground">从一个明确的角色开始</p>
      <p className="text-sm leading-7 text-muted-foreground">
        正文会原样保存在服务器，空白内容也可以暂存，发布前再补齐所有必填项
      </p>
    </>
  );
}
export function CreatorPreview({
  limits,
  children,
}: {
  limits?: ContentLimits;
  children?: ReactNode;
}) {
  return (
    <>
      <CreatorCard />
      <DraftChecks title="发布准备" {...(limits ? { limits } : {})}>
        {children}
      </DraftChecks>
    </>
  );
}
