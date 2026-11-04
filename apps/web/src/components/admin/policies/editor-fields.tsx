'use client';
import { useDeferredValue, useSyncExternalStore } from 'react';
import { useFormContext } from 'react-hook-form';
import type { PolicyDraftFields } from '@personamarket/contracts';
import { Input } from '@personamarket/ui/components/input';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
import { GuideBody } from '@/components/guides/guide-body';

const desktopQuery = '(min-width: 1280px)';
function subscribe(change: () => void) {
  const media = matchMedia(desktopQuery);
  media.addEventListener('change', change);
  return () => media.removeEventListener('change', change);
}
const desktopSnapshot = () => matchMedia(desktopQuery).matches;
const serverSnapshot = () => false;
function Inputs({ values }: { values: PolicyDraftFields }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<PolicyDraftFields>();
  return (
    <FieldGroup className="min-w-0 gap-5">
      <Field data-invalid={Boolean(errors.title)}>
        <FieldLabel htmlFor="policy-title">规则标题</FieldLabel>
        <Input
          id="policy-title"
          autoComplete="off"
          aria-invalid={Boolean(errors.title)}
          aria-describedby="policy-title-help policy-title-error"
          {...register('title')}
        />
        <FieldDescription id="policy-title-help">
          {Array.from(values.title).length} / 160 字
        </FieldDescription>
        <FieldError id="policy-title-error" errors={[errors.title]} />
      </Field>
      <Field data-invalid={Boolean(errors.summary)}>
        <FieldLabel htmlFor="policy-summary">简短介绍</FieldLabel>
        <Textarea
          id="policy-summary"
          rows={3}
          autoComplete="off"
          aria-invalid={Boolean(errors.summary)}
          aria-describedby="policy-summary-help policy-summary-error"
          {...register('summary')}
        />
        <FieldDescription id="policy-summary-help">
          {Array.from(values.summary).length} / 300 字，用于公开摘要
        </FieldDescription>
        <FieldError id="policy-summary-error" errors={[errors.summary]} />
      </Field>
      <Field data-invalid={Boolean(errors.bodyMarkdown)}>
        <FieldLabel htmlFor="policy-body">规则正文</FieldLabel>
        <Textarea
          id="policy-body"
          rows={15}
          autoComplete="off"
          spellCheck={false}
          className="max-h-[65dvh] min-h-72 resize-y font-mono"
          aria-invalid={Boolean(errors.bodyMarkdown)}
          aria-describedby="policy-body-help policy-body-error"
          {...register('bodyMarkdown')}
        />
        <FieldDescription id="policy-body-help">
          {Array.from(values.bodyMarkdown).length} / 30,000 字，支持安全
          Markdown，正文空白按原样保留
        </FieldDescription>
        <FieldError id="policy-body-error" errors={[errors.bodyMarkdown]} />
      </Field>
    </FieldGroup>
  );
}
function Preview({ values }: { values: PolicyDraftFields }) {
  const deferred = useDeferredValue(values);
  return (
    <section
      aria-label="规则草稿预览"
      aria-busy={deferred !== values}
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4"
    >
      <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">
        {deferred.title || '填写标题后在这里预览'}
      </h3>
      {deferred.summary && (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{deferred.summary}</p>
      )}
      <div
        role="region"
        aria-label="草稿正文预览"
        tabIndex={0}
        className="max-h-[65dvh] min-w-0 overflow-y-auto overscroll-contain rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
      >
        <GuideBody text={deferred.bodyMarkdown} />
      </div>
      <p className="text-sm text-muted-foreground">
        此处是当前输入，审核操作读取另一份冻结的送审快照
      </p>
    </section>
  );
}
export function PolicyEditorFields({
  values,
  tab,
  setTab,
}: {
  values: PolicyDraftFields;
  tab: 'edit' | 'preview';
  setTab: (value: 'edit' | 'preview') => void;
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
      <TabsList aria-label="编辑或预览规则草稿" className="h-auto min-h-12 w-full flex-wrap">
        <TabsTrigger value="edit" className="h-auto min-h-11 min-w-0 whitespace-normal">
          编辑正文
        </TabsTrigger>
        <TabsTrigger value="preview" className="h-auto min-h-11 min-w-0 whitespace-normal">
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
