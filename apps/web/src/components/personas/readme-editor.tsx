'use client';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import type { PersonaDraft } from '@personamarket/contracts';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '@personamarket/ui/components/field';
import { SafeMarkdown } from './safe-markdown';
import { EditorSection } from './draft-fields';
import { MediaPolicyNotice } from './media-policy-notice';
import { usePersonaMedia } from './persona-media';
const MarkdownInput = dynamic(() => import('./markdown-input'), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full" />,
});
export function ReadmeEditor({ step = '03' }: { step?: string }) {
  const form = useFormContext<PersonaDraft>();
  const value = useWatch({ control: form.control, name: 'readmeMarkdown' });
  const error = form.getFieldState('readmeMarkdown', form.formState).error?.message;
  const [tab, setTab] = useState('edit');
  const { accountId, policy } = usePersonaMedia();
  return (
    <EditorSection
      id="persona-readme"
      step={step}
      title="README"
      description="用 Markdown 介绍角色、使用方法与创作背景"
    >
      <Field>
        <FieldLabel>Markdown 介绍</FieldLabel>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value === 'preview' ? 'preview' : 'edit')}
        >
          <TabsList>
            <TabsTrigger value="edit">编辑介绍</TabsTrigger>
            <TabsTrigger value="preview">实时预览</TabsTrigger>
          </TabsList>
          <TabsContent value="edit" keepMounted>
            <MarkdownInput
              value={value}
              active={tab === 'edit'}
              onChange={(text) =>
                form.setValue('readmeMarkdown', text, { shouldDirty: true, shouldValidate: true })
              }
            />
          </TabsContent>
          <TabsContent value="preview">
            <div className="min-h-72 rounded-lg border p-5">
              {value ? (
                <SafeMarkdown text={value} />
              ) : (
                <p className="text-sm text-muted-foreground">写下一段介绍，就能在这里看到预览</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
        <FieldDescription>
          {Array.from(value).length.toLocaleString('zh-CN')} / 30,000 个字符
        </FieldDescription>
        {accountId && <MediaPolicyNotice policy={policy} />}
        {error && <FieldError>{error}</FieldError>}
      </Field>
    </EditorSection>
  );
}
