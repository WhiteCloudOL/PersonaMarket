'use client';
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ImportConfirmRequestSchema,
  type ImportPreviewResponseSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
} from '@personamarket/ui/components/select';
import { AuthField, FormNotice, SubmitButton } from '../auth/auth-fields';
import { importsApi } from '@/lib/imports-api';
import { personasApi } from '@/lib/personas-api';
import { EditorSection } from './editor-section';
import { usePrivateResult } from './use-private-result';
const ConfirmFieldsSchema = ImportConfirmRequestSchema.pick({
  title: true,
  sourceDescription: true,
  confirmed: true,
});
export type ImportConfirmationDetails = { title: string; sourceDescription: string };
export function ConfirmImport({
  preview,
  details,
  onDetailsChange,
  onComplete,
}: {
  preview: z.infer<typeof ImportPreviewResponseSchema>['data'];
  details?: ImportConfirmationDetails | undefined;
  onDetailsChange?: (value: ImportConfirmationDetails) => void;
  onComplete?: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const guard = usePrivateResult();
  const [target, setTarget] = useState('__new');
  const [page, setPage] = useState(1);
  const targets = useQuery({
    queryKey: ['private', 'import-targets', page],
    queryFn: () => personasApi.list(page),
    retry: false,
  });
  const current = useQuery({
    queryKey: ['private', 'persona', target],
    queryFn: () => personasApi.read(target),
    enabled: target !== '__new',
    retry: false,
  });
  const form = useForm<z.infer<typeof ConfirmFieldsSchema>>({
    resolver: zodResolver(ConfirmFieldsSchema),
    defaultValues: {
      title:
        details?.title ??
        Array.from(preview.filename.replace(/\.(json|toml|txt|md|markdown)$/i, ''))
          .slice(0, 80)
          .join(''),
      sourceDescription: details?.sourceDescription ?? '',
    },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof ConfirmFieldsSchema>) => {
      const accountId = guard.accountId();
      if (target !== '__new' && (!current.data || current.data.data.id !== target))
        throw new Error('请先读取要替换的服务器草稿');
      const destination =
        target === '__new'
          ? { mode: 'new' as const }
          : {
              mode: 'replace' as const,
              personaId: target,
              expectedRevision: current.data?.meta.revision ?? 0,
            };
      const result = await importsApi.confirm(
        accountId,
        ImportConfirmRequestSchema.parse({
          ...values,
          previewId: preview.id,
          contentHash: preview.contentHash,
          target: destination,
        }),
      );
      return { result, accountId };
    },
    onSuccess: ({ result, accountId }) => {
      if (guard.accepts(accountId)) {
        onComplete?.();
        router.push('/dashboard/personas/' + result.data.id + '/edit');
      }
    },
    retry: false,
    gcTime: 0,
  });
  const confirmed = useWatch({ control: form.control, name: 'confirmed' });
  return (
    <EditorSection title="确认导入" description="预览有效期 30 分钟，导入后仍需完善来源并主动发版">
      <form
        noValidate
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        className="flex flex-col gap-5"
      >
        <AuthField
          id={id + '-title'}
          label="人设名称"
          {...form.register('title')}
          onChange={(event) => {
            void form.register('title').onChange(event);
            onDetailsChange?.({
              title: event.target.value,
              sourceDescription: form.getValues('sourceDescription'),
            });
          }}
          error={form.formState.errors.title?.message}
        />
        <AuthField
          id={id + '-source'}
          label="文件来源说明"
          description="填写可核查的来源或你与原作品的关系，导入不会自动取得原创身份"
          {...form.register('sourceDescription')}
          onChange={(event) => {
            void form.register('sourceDescription').onChange(event);
            onDetailsChange?.({
              title: form.getValues('title'),
              sourceDescription: event.target.value,
            });
          }}
          error={form.formState.errors.sourceDescription?.message}
        />
        <Field>
          <FieldLabel id={id + '-target-label'}>导入目标</FieldLabel>
          <Select
            value={target}
            items={[
              { value: '__new', label: '新建私有草稿' },
              ...(targets.data?.data
                .filter((item) => item.platform === preview.persona.platform)
                .map((item) => ({ value: item.id, label: item.title || '未命名人设' })) ?? []),
            ]}
            onValueChange={(value) => {
              if (typeof value === 'string') setTarget(value);
            }}
          >
            <SelectTrigger aria-labelledby={id + '-target-label'} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="__new">新建私有草稿</SelectItem>
                {targets.data?.data
                  .filter((item) => item.platform === preview.persona.platform)
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title || '未命名人设'}
                    </SelectItem>
                  ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>只显示与你相同平台、属于当前账号的草稿</FieldDescription>
        </Field>
        <FormNotice error={targets.error ?? current.error} />
        {targets.data && targets.data.meta.total > 20 && (
          <div className="flex gap-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={page === 1}
              onClick={() => {
                setTarget('__new');
                setPage(page - 1);
              }}
            >
              上一页草稿
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={page * 20 >= targets.data.meta.total}
              onClick={() => {
                setTarget('__new');
                setPage(page + 1);
              }}
            >
              下一页草稿
            </Button>
          </div>
        )}
        {target !== '__new' && (
          <p
            role="status"
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm leading-7"
          >
            {current.isPending
              ? '正在读取服务器草稿…'
              : '将替换服务器草稿的全部正文与元数据，包括 README、图片引用和推荐模型，已发布版本保持可用；其他页面已有修改时会阻止覆盖'}
          </p>
        )}
        <Field>
          <div className="flex items-start gap-3">
            <Checkbox
              id={id + '-confirmed'}
              checked={confirmed === true}
              onCheckedChange={(checked) => {
                if (checked) form.setValue('confirmed', true, { shouldValidate: true });
                else form.resetField('confirmed');
              }}
            />
            <FieldLabel htmlFor={id + '-confirmed'} className="text-sm leading-6">
              我已核对正文、忽略字段和来源，确认按上述范围导入私有草稿
            </FieldLabel>
          </div>
          {form.formState.errors.confirmed && (
            <FieldError>{form.formState.errors.confirmed.message}</FieldError>
          )}
        </Field>
        <FormNotice error={mutation.error} />
        <SubmitButton pending={mutation.isPending}>确认导入草稿</SubmitButton>
      </form>
    </EditorSection>
  );
}
