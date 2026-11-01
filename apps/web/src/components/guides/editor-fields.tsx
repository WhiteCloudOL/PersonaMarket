'use client';
import { useDeferredValue, useSyncExternalStore } from 'react';
import { useFormContext } from 'react-hook-form';
import type { GuideWrite } from '@personamarket/contracts';
import { Input } from '@personamarket/ui/components/input';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
import { GuideBody } from './guide-body';

const desktopQuery = '(min-width: 1024px)';
function subscribe(change: () => void) {
  const media = matchMedia(desktopQuery);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
}
const desktopSnapshot = () => matchMedia(desktopQuery).matches;
const serverSnapshot = () => false;
function Inputs({ values }: { values: GuideWrite }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<GuideWrite>();
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Field data-invalid={Boolean(errors.title)}>
        <FieldLabel htmlFor="guide-title">指南标题</FieldLabel>
        <Input
          id="guide-title"
          autoComplete="off"
          aria-invalid={Boolean(errors.title)}
          aria-describedby="guide-title-help guide-title-error"
          {...register('title')}
        />
        <FieldDescription id="guide-title-help">
          {Array.from(values.title).length} / 160 字
        </FieldDescription>
        <FieldError id="guide-title-error" errors={[errors.title]} />
      </Field>
      <Field data-invalid={Boolean(errors.summary)}>
        <FieldLabel htmlFor="guide-summary">简短介绍</FieldLabel>
        <Textarea
          id="guide-summary"
          autoComplete="off"
          rows={3}
          aria-invalid={Boolean(errors.summary)}
          aria-describedby="guide-summary-help guide-summary-error"
          {...register('summary')}
        />
        <FieldDescription id="guide-summary-help">
          {Array.from(values.summary).length} / 300 字，用于目录和分享摘要
        </FieldDescription>
        <FieldError id="guide-summary-error" errors={[errors.summary]} />
      </Field>
      <Field data-invalid={Boolean(errors.bodyMarkdown)}>
        <FieldLabel htmlFor="guide-body">指南正文</FieldLabel>
        <Textarea
          id="guide-body"
          autoComplete="off"
          rows={14}
          spellCheck={false}
          className="max-h-[65dvh] min-h-64 resize-y font-mono"
          aria-invalid={Boolean(errors.bodyMarkdown)}
          aria-describedby="guide-body-help guide-body-error"
          {...register('bodyMarkdown')}
        />
        <FieldDescription id="guide-body-help">
          {Array.from(values.bodyMarkdown).length} / 30000 字，支持安全 Markdown，正文空白按原样保存
        </FieldDescription>
        <FieldError id="guide-body-error" errors={[errors.bodyMarkdown]} />
      </Field>
    </div>
  );
}
function Preview({ values }: { values: GuideWrite }) {
  const deferred = useDeferredValue(values);
  return (
    <section
      aria-label="指南编辑稿预览"
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4"
      aria-busy={deferred !== values}
    >
      <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">
        {deferred.title || '填写指南标题后在这里预览'}
      </h3>
      {deferred.summary && (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{deferred.summary}</p>
      )}
      <div
        role="region"
        aria-label="编辑稿正文预览"
        tabIndex={0}
        className="max-h-[65dvh] min-w-0 overflow-y-auto overscroll-contain rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
      >
        <GuideBody text={deferred.bodyMarkdown} />
      </div>
      <p className="text-sm text-muted-foreground">
        读者会看到最近一次确认发布的内容，图片也按公开访问权限预览
      </p>
    </section>
  );
}
export function GuideEditorFields({
  values,
  tab,
  setTab,
}: {
  values: GuideWrite;
  tab: 'edit' | 'preview';
  setTab: (tab: 'edit' | 'preview') => void;
}) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, serverSnapshot);
  if (desktop)
    return (
      <div className="grid min-w-0 grid-cols-2 items-start gap-5">
        <Inputs values={values} />
        <Preview values={values} />
      </div>
    );
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (value === 'edit' || value === 'preview') setTab(value);
      }}
      className="min-w-0 gap-4"
    >
      <TabsList aria-label="编辑或预览指南" className="h-12 w-full">
        <TabsTrigger value="edit" className="min-h-11">
          编辑正文
        </TabsTrigger>
        <TabsTrigger value="preview" className="min-h-11">
          查看预览
        </TabsTrigger>
      </TabsList>
      <TabsContent value="edit" keepMounted className="min-w-0">
        <Inputs values={values} />
      </TabsContent>
      <TabsContent value="preview" keepMounted className="min-w-0">
        <Preview values={values} />
      </TabsContent>
    </Tabs>
  );
}
