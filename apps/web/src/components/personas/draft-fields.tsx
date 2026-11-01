'use client';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import type { PersonaDraft, ContentLimits } from '@personamarket/contracts';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { Input } from '@personamarket/ui/components/input';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Button } from '@personamarket/ui/components/button';
import { EditorSection } from './editor-section';
export { EditorSection } from './editor-section';

type TextPath =
  | 'title'
  | 'summary'
  | 'readmeMarkdown'
  | 'authorNotes'
  | 'content.personality'
  | 'content.replyStyle'
  | 'content.behaviorStyle'
  | 'content.systemPrompt'
  | `content.dialoguePairs.${number}.user`
  | `content.dialoguePairs.${number}.assistant`
  | `recommendedModels.${number}.modelId`
  | `recommendedModels.${number}.note`
  | 'origin.originalAuthor'
  | 'origin.sourceUrl'
  | 'origin.sourceDescription'
  | 'origin.authorizationStatement'
  | 'origin.policyText';
export function DraftText({
  name,
  label,
  limit,
  multiline = false,
  description,
}: {
  name: TextPath;
  label: string;
  limit: number;
  multiline?: boolean;
  description?: string;
}) {
  const form = useFormContext<PersonaDraft>();
  const raw = useWatch({ control: form.control, name });
  const value = typeof raw === 'string' ? raw : '';
  const id = 'draft-' + name.replaceAll('.', '-');
  const error = form.getFieldState(name, form.formState).error?.message;
  const props = {
    ...form.register(name),
    id,
    'aria-describedby':
      [...(description || multiline ? [id + '-help'] : []), ...(error ? [id + '-error'] : [])].join(
        ' ',
      ) || undefined,
    'aria-invalid': Boolean(error),
    autoComplete: 'off',
  };
  return (
    <Field data-invalid={Boolean(error)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <span
          className={
            Array.from(value).length > limit
              ? 'text-xs text-destructive'
              : 'text-xs tabular-nums text-muted-foreground'
          }
        >
          {Array.from(value).length.toLocaleString('zh-CN')} / {limit.toLocaleString('zh-CN')}
        </span>
      </div>
      {multiline ? (
        <Textarea {...props} className="max-h-[32rem] min-h-48 resize-y leading-7" />
      ) : (
        <Input {...props} />
      )}
      {(description || multiline) && (
        <FieldDescription id={id + '-help'}>
          {description ?? '保留原始文本与空白，内容不会直接发布'}
        </FieldDescription>
      )}
      {error && <FieldError id={id + '-error'}>{error}</FieldError>}
    </Field>
  );
}
export function MaiBotFields({ limits, step = '02' }: { limits: ContentLimits; step?: string }) {
  return (
    <EditorSection
      id="persona-content"
      step={step}
      title="MaiBot 人设正文"
      description="三个独立字段，分别定义角色的性格、表达与行动"
    >
      <div className="grid min-w-0 gap-5 @min-[44rem]/field-group:grid-cols-3">
        <DraftText
          name="content.personality"
          label="人格设定"
          limit={limits.maibotField}
          multiline
          description="角色是谁，以及如何理解周围的世界"
        />
        <DraftText
          name="content.replyStyle"
          label="表达风格"
          limit={limits.maibotField}
          multiline
          description="角色的语气、措辞与回复习惯"
        />
        <DraftText
          name="content.behaviorStyle"
          label="行为风格"
          limit={limits.maibotField}
          multiline
          description="角色面对不同场景时的行动原则"
        />
      </div>
    </EditorSection>
  );
}
export function AstrBotFields({ limits, step = '02' }: { limits: ContentLimits; step?: string }) {
  const form = useFormContext<PersonaDraft>();
  const array = useFieldArray({
    control: form.control,
    name: 'content.dialoguePairs',
    keyName: 'rowKey',
  });
  return (
    <>
      <EditorSection
        id="persona-content"
        step={step}
        title="人格设定"
        description="定义角色的背景、性格与交流方式"
      >
        <DraftText
          name="content.systemPrompt"
          label="人格设定"
          limit={limits.astrbotPrompt}
          multiline
        />
      </EditorSection>
      <EditorSection
        title="预设对话"
        description={`已添加 ${array.fields.length} / ${limits.dialoguePairs} 对，按顺序填写用户消息与角色回复`}
      >
        {array.fields.length === 0 && (
          <p className="text-sm text-muted-foreground">
            可以直接使用人格设定，也可以添加几组对话展示角色的回应
          </p>
        )}
        {array.fields.map((field, index) => (
          <div key={field.rowKey} className="flex flex-col gap-4 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">对话 {index + 1}</h3>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => array.move(index, index - 1)}
                  aria-label={`上移对话 ${index + 1}`}
                >
                  上移
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={index === array.fields.length - 1}
                  onClick={() => array.move(index, index + 1)}
                  aria-label={`下移对话 ${index + 1}`}
                >
                  下移
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={array.fields.length >= limits.dialoguePairs}
                  onClick={() => {
                    const pair = form.getValues(`content.dialoguePairs.${index}`);
                    if (pair) array.insert(index + 1, { ...pair, id: crypto.randomUUID() });
                  }}
                  aria-label={`为对话 ${index + 1} 添加副本`}
                >
                  添加副本
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => array.remove(index)}
                  aria-label={`删除对话 ${index + 1}`}
                >
                  删除
                </Button>
              </div>
            </div>
            <DraftText
              name={`content.dialoguePairs.${index}.user`}
              label={`对话 ${index + 1} · 用户`}
              limit={limits.dialogueMessage}
              multiline
            />
            <DraftText
              name={`content.dialoguePairs.${index}.assistant`}
              label={`对话 ${index + 1} · AI`}
              limit={limits.dialogueMessage}
              multiline
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={array.fields.length >= limits.dialoguePairs}
          onClick={() => array.append({ id: crypto.randomUUID(), user: '', assistant: '' })}
        >
          添加一对对话
        </Button>
      </EditorSection>
    </>
  );
}
