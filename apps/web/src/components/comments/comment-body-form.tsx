'use client';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CommentBodySchema } from '@personamarket/contracts';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@personamarket/ui/components/field';
import { ApiError } from '@/lib/auth-api';
import { retainsCommentDraft, type CommentDocumentIdentity } from '@/lib/comments-state';
import { FormNotice, SubmitButton } from '../auth/auth-fields';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { useCommentDrafts } from './comment-drafts';

export function CommentBodyForm({
  initialBody = '',
  maxLength,
  label,
  submitLabel,
  onSubmit,
  children,
  disabled = false,
  requestScope = '',
  onDirtyChange,
  onBusyChange,
  draftKey,
  retainedDocument,
}: {
  initialBody?: string;
  maxLength: number;
  label: string;
  submitLabel: string;
  onSubmit: (body: string, key: string) => Promise<{ body: string; message: string }>;
  children?: ReactNode;
  disabled?: boolean;
  requestScope?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  draftKey?: string;
  retainedDocument?: CommentDocumentIdentity;
}) {
  const id = useId();
  const drafts = useCommentDrafts();
  const [restoredBody] = useState(() => (draftKey ? drafts?.read(draftKey) : undefined));
  const schema = z.strictObject({
    body: CommentBodySchema.refine(
      (value) => Array.from(value).length <= maxLength,
      `评论最多 ${maxLength} 字`,
    ),
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { body: restoredBody ?? initialBody },
  });
  const body = useWatch({ control: form.control, name: 'body' });
  const last = useRef<{ signature: string; key: string } | null>(null);
  const [error, setError] = useState<Error>();
  const [message, setMessage] = useState<string>();
  const dirty = draftKey ? body !== initialBody : form.formState.isDirty;
  const personaId = retainedDocument?.personaId,
    releaseId = retainedDocument?.releaseId;
  const retainsDraft = useCallback(
    (target: URL, current: URL) =>
      retainsCommentDraft(
        target,
        current,
        personaId && releaseId ? { personaId, releaseId } : undefined,
      ),
    [personaId, releaseId],
  );
  useUnsavedDraft(
    dirty,
    '评论还有未提交的内容，确定离开吗',
    draftKey && drafts ? retainsDraft : undefined,
  );
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange?.(form.formState.isSubmitting);
  }, [form.formState.isSubmitting, onBusyChange]);
  return (
    <form
      noValidate
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(event) => {
        void form.handleSubmit(async (value) => {
          if (disabled) return;
          setError(undefined);
          setMessage(undefined);
          const signature = requestScope + '\0' + value.body;
          if (!last.current || last.current.signature !== signature)
            last.current = { signature, key: crypto.randomUUID() };
          try {
            const result = await onSubmit(value.body, last.current.key);
            if (draftKey) drafts?.write(draftKey, '');
            form.reset({ body: result.body });
            last.current = null;
            setMessage(result.message);
          } catch (cause) {
            setError(cause instanceof Error ? cause : new Error('评论暂时无法提交，请稍后重试'));
            if (cause instanceof ApiError)
              for (const field of cause.fieldErrors)
                if (field.path === 'body') form.setError('body', { message: field.message });
          }
        })(event);
      }}
    >
      <FieldGroup>
        <Field data-invalid={Boolean(form.formState.errors.body)}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Textarea
            id={id}
            rows={5}
            {...form.register('body')}
            autoComplete="off"
            onChange={(event) => {
              void form.register('body').onChange(event);
              if (draftKey) drafts?.write(draftKey, event.target.value);
            }}
            aria-invalid={Boolean(form.formState.errors.body)}
            aria-describedby={id + '-description'}
            disabled={form.formState.isSubmitting}
            className="min-h-32 resize-y"
          />
          <FieldDescription id={id + '-description'}>
            纯文本评论，保留换行与空白 · {Array.from(body).length} / {maxLength} 字
          </FieldDescription>
          <FieldError errors={[form.formState.errors.body]} />
        </Field>
      </FieldGroup>
      <FormNotice error={error} message={message} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pending={form.formState.isSubmitting} disabled={disabled}>
          {submitLabel}
        </SubmitButton>
        {children}
      </div>
    </form>
  );
}
