'use client';
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CreateReportSchema, type CreateReport, type OwnReport } from '@personamarket/contracts';
import type { z } from 'zod';
import { buttonVariants } from '@personamarket/ui/components/button';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '@personamarket/ui/components/field';
import { reportsApi, reportsKey } from '@/lib/reports-api';
import { FormNotice, SubmitButton } from '../auth/auth-fields';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { ReportSelect } from './select';
import { reportReasons } from './labels';

type Nonce = { signature: string; key: string };
type Draft = { values: z.input<typeof CreateReportSchema>; nonce: Nonce | undefined };
const reasons = Object.entries(reportReasons).map(([value, label]) => ({ value, label }));
export function CreateReportForm({
  accountId,
  target,
  onDirty,
  onBusy,
}: {
  accountId: string;
  target: CreateReport['target'];
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const client = useQueryClient(),
    encodedTarget = JSON.stringify(target);
  const fieldId = useId();
  const key = useMemo(
    () => [...reportsKey(accountId), 'draft', encodedTarget],
    [accountId, encodedTarget],
  );
  const [saved] = useState(() => client.getQueryData<Draft>(key));
  const nonce = useRef<Nonce | undefined>(saved?.nonce),
    alive = useRef(true);
  const [created, setCreated] = useState<OwnReport>();
  const form = useForm<z.input<typeof CreateReportSchema>, unknown, CreateReport>({
    resolver: zodResolver(CreateReportSchema),
    defaultValues: saved?.values ?? { target, reason: 'other', details: '' },
  });
  const details = useWatch({ control: form.control, name: 'details' }),
    reason = useWatch({ control: form.control, name: 'reason' });
  const dirty = !created && Boolean(details || reason !== 'other');
  const mutation = useMutation({
    mutationFn: (input: CreateReport) => {
      const signature = JSON.stringify(input);
      if (!nonce.current || nonce.current.signature !== signature)
        nonce.current = { signature, key: crypto.randomUUID() };
      client.setQueryData(key, { values: input, nonce: nonce.current } satisfies Draft);
      return reportsApi.create(accountId, input, nonce.current.key);
    },
    retry: false,
    onSuccess: (result) => {
      if (!alive.current) return;
      setCreated(result.data);
      form.reset({ target, reason: 'other', details: '' });
      client.removeQueries({ queryKey: key, exact: true });
      void client.invalidateQueries({ queryKey: [...reportsKey(accountId), 'list'] });
    },
  });
  useUnsavedDraft(dirty || mutation.isPending, '举报说明尚未提交，确定离开吗');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    client.setQueryDefaults(key, { gcTime: Infinity });
  }, [client, key]);
  useEffect(() => {
    if (!created && (dirty || nonce.current))
      client.setQueryData(key, { values: form.getValues(), nonce: nonce.current } satisfies Draft);
    else client.removeQueries({ queryKey: key, exact: true });
  }, [client, key, form, details, reason, dirty, created]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    onBusy(mutation.isPending);
    return () => onBusy(false);
  }, [mutation.isPending, onBusy]);
  if (created)
    return (
      <div className="flex flex-col gap-4">
        <FormNotice message="举报已提交，补充说明仅自己和管理员可见" />
        <Link
          className={buttonVariants()}
          href={'/dashboard/reports?report=' + created.id}
          prefetch={false}
        >
          查看这条举报
        </Link>
      </div>
    );
  return (
    <form noValidate onSubmit={form.handleSubmit((input) => mutation.mutate(input))}>
      <FieldGroup>
        <Controller
          name="reason"
          control={form.control}
          render={({ field }) => (
            <Field data-invalid={Boolean(form.formState.errors.reason)}>
              <FieldLabel htmlFor={fieldId + '-reason'}>举报原因</FieldLabel>
              <ReportSelect
                id={fieldId + '-reason'}
                value={field.value}
                onChange={field.onChange}
                options={reasons}
                disabled={mutation.isPending}
                invalid={Boolean(form.formState.errors.reason)}
              />
              <FieldError errors={[form.formState.errors.reason]} />
            </Field>
          )}
        />
        <Field data-invalid={Boolean(form.formState.errors.details)}>
          <FieldLabel htmlFor={fieldId + '-details'}>补充说明</FieldLabel>
          <Textarea
            id={fieldId + '-details'}
            className="max-h-[40dvh]"
            rows={7}
            autoComplete="off"
            aria-invalid={Boolean(form.formState.errors.details)}
            aria-describedby={fieldId + '-help'}
            disabled={mutation.isPending}
            {...form.register('details')}
          />
          <FieldDescription id={fieldId + '-help'}>
            说明问题位置、原始来源或相关线索，避免提交密码等账号秘密 ·{' '}
            {Array.from(details ?? '').length} / 5000 字
          </FieldDescription>
          <FieldError errors={[form.formState.errors.details]} />
        </Field>
        <p className="text-sm leading-6 text-muted-foreground">
          系统保存当前公开版本或已获批评论，同一份内容的待处理举报无需重复提交
        </p>
        <FormNotice error={mutation.error} />
        <SubmitButton pending={mutation.isPending}>提交举报</SubmitButton>
        <Link
          className={buttonVariants({ variant: 'outline' })}
          href="/dashboard/reports"
          prefetch={false}
        >
          查看我的举报
        </Link>
      </FieldGroup>
    </form>
  );
}
