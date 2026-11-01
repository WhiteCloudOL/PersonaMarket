'use client';
import { useId, useState } from 'react';
import { useForm, useFieldArray, type FieldPath, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MappedPersonaContentSchema, type Platform } from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Spinner } from '@personamarket/ui/components/spinner';
import { FormNotice } from '../auth/auth-fields';

type Values = z.infer<typeof MappedPersonaContentSchema>;
export type TextScope = 'selection' | 'all';
type TextReader = (scope: TextScope) => string | null;

function MappingField({
  form,
  name,
  label,
  readText,
  pending,
}: {
  form: UseFormReturn<Values>;
  name: FieldPath<Values>;
  label: string;
  readText: TextReader;
  pending: boolean;
}) {
  const id = useId();
  const error = form.getFieldState(name, form.formState).error;
  const fill = (scope: TextScope) => {
    const text = readText(scope);
    if (text !== null) form.setValue(name, text, { shouldDirty: true, shouldValidate: true });
  };
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        {...form.register(name)}
        disabled={pending}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? id + '-error' : undefined}
        className="h-40 min-h-36 field-sizing-fixed"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 max-w-full whitespace-normal py-2"
          disabled={pending}
          onClick={() => fill('selection')}
        >
          选中文本填入{label}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-h-11 max-w-full whitespace-normal py-2"
          disabled={pending}
          onClick={() => fill('all')}
        >
          全文填入{label}
        </Button>
      </div>
      {error && <FieldError id={id + '-error'}>{error.message}</FieldError>}
    </Field>
  );
}

export function ManualImportMapping({
  platform,
  initialValues,
  readText,
  onPreview,
  pending,
  error,
  onCancel,
}: {
  platform: Platform;
  initialValues: Values | undefined;
  readText: TextReader;
  onPreview: (values: Values) => void;
  pending: boolean;
  error: Error | null;
  onCancel: () => void;
}) {
  const id = useId();
  const [confirmed, setConfirmed] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(MappedPersonaContentSchema),
    defaultValues:
      initialValues ??
      (platform === 'maibot'
        ? { platform, content: { personality: '', replyStyle: '', behaviorStyle: '' } }
        : { platform, content: { systemPrompt: '', dialoguePairs: [] } }),
  });
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => {
        if (!confirmed) {
          form.setError('root.mapping', { message: '请逐项核对字段映射后勾选确认' });
          return;
        }
        onPreview(values);
      })}
      className="flex flex-col gap-6"
    >
      <FieldGroup>
        {platform === 'maibot' ? (
          <>
            <MappingField
              form={form}
              name="content.personality"
              label="人格设定"
              readText={readText}
              pending={pending}
            />
            <MappingField
              form={form}
              name="content.replyStyle"
              label="表达风格"
              readText={readText}
              pending={pending}
            />
            <MappingField
              form={form}
              name="content.behaviorStyle"
              label="行为风格"
              readText={readText}
              pending={pending}
            />
          </>
        ) : (
          <AstrBotFields form={form} readText={readText} pending={pending} />
        )}
        <Field data-invalid={Boolean(form.formState.errors.root?.mapping)}>
          <div className="flex items-start gap-3">
            <Checkbox
              id={id + '-mapped'}
              checked={confirmed}
              aria-invalid={Boolean(form.formState.errors.root?.mapping)}
              aria-describedby={
                form.formState.errors.root?.mapping ? id + '-mapping-error' : undefined
              }
              disabled={pending}
              onCheckedChange={(checked) => {
                setConfirmed(checked === true);
                form.clearErrors('root.mapping');
              }}
            />
            <FieldLabel htmlFor={id + '-mapped'}>
              我已逐项核对字段映射，原文中的其他内容不会导入
            </FieldLabel>
          </div>
          <FieldDescription>
            只保存你确认的字段，当前限额以预览结果为准，超过限额时保留输入并提示调整
          </FieldDescription>
          {form.formState.errors.root?.mapping && (
            <FieldError id={id + '-mapping-error'}>
              {form.formState.errors.root.mapping.message}
            </FieldError>
          )}
        </Field>
      </FieldGroup>
      <FormNotice error={error} />
      <Button
        type="submit"
        disabled={pending}
        className="h-auto min-h-11 max-w-full whitespace-normal py-2"
      >
        {pending && <Spinner data-icon="inline-start" className="motion-reduce:animate-none" />}
        {pending ? '正在处理…' : '核对映射预览'}
      </Button>
      {pending && (
        <Button type="button" variant="outline" onClick={onCancel}>
          取消预览
        </Button>
      )}
    </form>
  );
}

function AstrBotFields({
  form,
  readText,
  pending,
}: {
  form: UseFormReturn<Values>;
  readText: TextReader;
  pending: boolean;
}) {
  const pairs = useFieldArray({
    control: form.control,
    name: 'content.dialoguePairs',
    keyName: 'formKey',
  });
  return (
    <>
      <MappingField
        form={form}
        name="content.systemPrompt"
        label="系统提示词"
        readText={readText}
        pending={pending}
      />
      <FieldGroup>
        {pairs.fields.map((pair, index) => (
          <section
            key={pair.formKey}
            className="flex min-w-0 flex-col gap-4 rounded-xl border p-4"
            aria-label={'预设对话 ' + (index + 1)}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">预设对话 {index + 1}</h3>
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-11 max-w-full whitespace-normal py-2"
                disabled={pending}
                onClick={() => pairs.remove(index)}
              >
                删除对话 {index + 1}
              </Button>
            </div>
            <MappingField
              form={form}
              name={`content.dialoguePairs.${index}.user`}
              label={'用户消息 ' + (index + 1)}
              readText={readText}
              pending={pending}
            />
            <MappingField
              form={form}
              name={`content.dialoguePairs.${index}.assistant`}
              label={'AI 回复 ' + (index + 1)}
              readText={readText}
              pending={pending}
            />
          </section>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={pending || pairs.fields.length >= 100}
          onClick={() => pairs.append({ id: crypto.randomUUID(), user: '', assistant: '' })}
        >
          添加成对对话
        </Button>
        <FieldDescription>每组包含用户消息与 AI 回复，留空的行需补齐或删除</FieldDescription>
      </FieldGroup>
    </>
  );
}
