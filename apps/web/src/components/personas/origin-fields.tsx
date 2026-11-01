'use client';
import { useRef } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import type { PersonaDraft } from '@personamarket/contracts';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@personamarket/ui/components/select';
import { Field, FieldLabel } from '@personamarket/ui/components/field';
import { DraftText, EditorSection } from './draft-fields';
type Origin = PersonaDraft['origin'];
export function OriginFields({ step = '07' }: { step?: string }) {
  const form = useFormContext<PersonaDraft>();
  const origin = useWatch({ control: form.control, name: 'origin' });
  const accepted = useWatch({ control: form.control, name: 'rightsAccepted' });
  const retained = useRef<{
    original: Extract<Origin, { type: 'original' }>;
    repost: Extract<Origin, { type: 'repost' }>;
  }>({
    original: { type: 'original', redistribution: 'contact_required' },
    repost: {
      type: 'repost',
      redistribution: 'contact_required',
      originalAuthor: '',
      authorizationStatement: '',
      sourceUrl: '',
      sourceDescription: '',
    },
  });
  const policyLabels = {
    contact_required: '须联系授权',
    not_allowed: '禁止再转载',
    attribution_required: '允许但须署名',
    custom: '自定义说明',
  };
  return (
    <EditorSection
      id="persona-origin"
      title="作品来源"
      step={step}
      description="站内发布者来自当前账号，原作者与转载依据会随版本保留"
    >
      <Field>
        <FieldLabel id="origin-label">来源类型</FieldLabel>
        <ToggleGroup
          value={[origin.type]}
          aria-labelledby="origin-label"
          variant="outline"
          onValueChange={(selected) => {
            const next = selected[0];
            if (next !== 'original' && next !== 'repost') return;
            const current = form.getValues('origin');
            if (current.type === 'original') retained.current.original = structuredClone(current);
            else retained.current.repost = structuredClone(current);
            form.setValue('origin', structuredClone(retained.current[next]), { shouldDirty: true });
          }}
        >
          <ToggleGroupItem value="original">原创作品</ToggleGroupItem>
          <ToggleGroupItem value="repost">转载作品</ToggleGroupItem>
        </ToggleGroup>
      </Field>
      {origin.type === 'repost' && (
        <>
          <DraftText name="origin.originalAuthor" label="原作者" limit={100} />
          <DraftText
            name="origin.sourceUrl"
            label="来源链接"
            limit={2000}
            description="填写 HTTP 或 HTTPS 链接，或在下方补充可核查的来源说明"
          />
          <DraftText name="origin.sourceDescription" label="来源说明" limit={2000} multiline />
          <DraftText
            name="origin.authorizationStatement"
            label="转载授权依据"
            limit={5000}
            multiline
          />
        </>
      )}
      <Field>
        <FieldLabel id="policy-label">转载许可</FieldLabel>
        <Select
          items={policyLabels}
          value={origin.redistribution}
          onValueChange={(value) => {
            if (value && value in policyLabels)
              form.setValue('origin.redistribution', value, { shouldDirty: true });
          }}
        >
          <SelectTrigger aria-labelledby="policy-label" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {Object.entries(policyLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {origin.redistribution === 'custom' && (
        <DraftText name="origin.policyText" label="自定义转载规则" limit={5000} multiline />
      )}
      <DraftText name="authorNotes" label="作者使用说明" limit={2000} multiline />
      <Field orientation="horizontal">
        <Checkbox
          id="rights-accepted"
          checked={accepted}
          onCheckedChange={(value) => form.setValue('rightsAccepted', value, { shouldDirty: true })}
        />
        <FieldLabel htmlFor="rights-accepted" className="text-sm leading-6">
          我确认有权提交这些内容，并授权站点按本页声明展示和提供复制下载
        </FieldLabel>
      </Field>
    </EditorSection>
  );
}
