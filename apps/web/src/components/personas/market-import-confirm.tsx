'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MarketImportConfirmSchema, type MarketImportPreview } from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '@personamarket/ui/components/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@personamarket/ui/components/select';
import { AuthField, FormNotice, SubmitButton } from '../auth/auth-fields';
import { marketImportsApi } from '@/lib/market-imports-api';
import { personasApi } from '@/lib/personas-api';
import { EditorSection } from './editor-section';
import { usePrivateResult } from './use-private-result';

const FieldsSchema = MarketImportConfirmSchema.pick({
  title: true,
  sourceDescription: true,
  authorizationStatement: true,
  confirmed: true,
});
export function MarketImportConfirm({
  preview,
  onBack,
  onComplete,
}: {
  preview: MarketImportPreview;
  onBack: () => void;
  onComplete: () => void;
}) {
  const router = useRouter();
  const client = useQueryClient();
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
  const form = useForm<z.infer<typeof FieldsSchema>>({
    resolver: zodResolver(FieldsSchema),
    defaultValues: {
      title:
        preview.draft.title ||
        Array.from(preview.filename.replace(/(?:\.persona)?\.(?:json|zip)$/i, ''))
          .slice(0, 80)
          .join(''),
      sourceDescription:
        preview.draft.origin.type === 'repost'
          ? preview.draft.origin.sourceDescription || preview.source?.personaUrl || ''
          : '',
      authorizationStatement:
        preview.draft.origin.type === 'repost'
          ? (preview.draft.origin.authorizationStatement ?? '')
          : '',
    },
  });
  const confirmed = useWatch({ control: form.control, name: 'confirmed' });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof FieldsSchema>) => {
      const accountId = guard.accountId();
      if (target !== '__new' && (!current.data || current.data.data.id !== target))
        throw new Error('请先读取要替换的服务器草稿');
      const result = await marketImportsApi.confirm(
        accountId,
        MarketImportConfirmSchema.parse({
          ...values,
          previewId: preview.id,
          contentHash: preview.contentHash,
          target:
            target === '__new'
              ? { mode: 'new' }
              : {
                  mode: 'replace',
                  personaId: target,
                  expectedRevision: current.data?.meta.revision ?? 0,
                },
        }),
      );
      return { result, accountId };
    },
    onSuccess: ({ result, accountId }) => {
      if (!guard.accepts(accountId)) return;
      onComplete();
      void client.invalidateQueries({ queryKey: ['private', 'personas'] });
      router.push('/dashboard/personas/' + result.data.id + '/edit');
    },
    retry: false,
    gcTime: 0,
  });
  const choices =
    targets.data?.data.filter((item) => item.platform === preview.draft.platform) ?? [];
  const items = Object.fromEntries([
    ['__new', '新建私有草稿'],
    ...choices.map((item) => [item.id, item.title || '未命名人设']),
    ...(target !== '__new' && current.data
      ? [[target, current.data.data.draft.title || '未命名人设']]
      : []),
  ]);
  return (
    <EditorSection title="来源与保存位置" description="保留原作者和转载规则，再确认本次导入的依据">
      <form
        noValidate
        className="space-y-5"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <AuthField
          id={'import-title-' + preview.id}
          label="导入后的人设名称"
          autoComplete="off"
          {...form.register('title')}
          error={form.formState.errors.title?.message}
        />
        <div className="rounded-xl bg-accent/60 p-4 text-base leading-7">
          <span className="text-muted-foreground">保留的原作者 / 源发布者：</span>
          <strong className="break-words font-medium">
            {preview.draft.origin.type === 'repost'
              ? preview.draft.origin.originalAuthor || '未注明，保存后请补充'
              : '未注明'}
          </strong>
        </div>
        <Field>
          <FieldLabel htmlFor={'import-source-' + preview.id}>来源说明</FieldLabel>
          <Textarea
            id={'import-source-' + preview.id}
            rows={3}
            {...form.register('sourceDescription')}
            aria-invalid={Boolean(form.formState.errors.sourceDescription)}
            aria-describedby={'import-source-error-' + preview.id}
          />
          <FieldError id={'import-source-error-' + preview.id}>
            {form.formState.errors.sourceDescription?.message}
          </FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor={'import-permission-' + preview.id}>本次转载依据</FieldLabel>
          <Textarea
            id={'import-permission-' + preview.id}
            rows={4}
            {...form.register('authorizationStatement')}
            aria-invalid={Boolean(form.formState.errors.authorizationStatement)}
            aria-describedby={
              'import-permission-help-' + preview.id + ' import-permission-error-' + preview.id
            }
          />
          <FieldDescription id={'import-permission-help-' + preview.id}>
            文件中的声明需要本人核实，导入不会自动取得源站原创身份或授权
          </FieldDescription>
          <FieldError id={'import-permission-error-' + preview.id}>
            {form.formState.errors.authorizationStatement?.message}
          </FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor={'import-target-' + preview.id}>保存位置</FieldLabel>
          <Select
            items={items}
            value={target}
            onValueChange={(value) => {
              if (typeof value === 'string') setTarget(value);
            }}
          >
            <SelectTrigger id={'import-target-' + preview.id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="__new">新建私有草稿</SelectItem>
                {choices.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    <span className="whitespace-normal break-words">
                      {item.title || '未命名人设'}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {targets.data && targets.data.meta.total > targets.data.meta.pageSize && (
            <nav aria-label="导入目标分页" className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage((value) => value - 1)}
              >
                上一页
              </Button>
              <span className="text-sm">第 {page} 页</span>
              <Button
                type="button"
                variant="outline"
                disabled={page * targets.data.meta.pageSize >= targets.data.meta.total}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
              </Button>
            </nav>
          )}
          <FormNotice error={targets.error} />
          {targets.isError && (
            <Button type="button" variant="outline" onClick={() => void targets.refetch()}>
              重试读取我的草稿
            </Button>
          )}
        </Field>
        {target !== '__new' && (
          <div className="space-y-3 rounded-xl border p-4 text-sm leading-6">
            <p>仅覆盖所选作品的工作草稿，公开版本保持原状</p>
            {current.data && (
              <p className="text-muted-foreground">
                已读取服务器修订 {current.data.meta.revision}，保存前仍会检查并发更新
              </p>
            )}
            <FormNotice error={current.error} />
            <Button
              type="button"
              variant="outline"
              disabled={current.isFetching}
              onClick={() => void current.refetch()}
            >
              重新读取保存位置
            </Button>
          </div>
        )}
        <Field>
          <div className="flex items-start gap-3">
            <Checkbox
              id={'import-accepted-' + preview.id}
              checked={confirmed === true}
              aria-invalid={Boolean(form.formState.errors.confirmed)}
              aria-describedby={'import-accepted-error-' + preview.id}
              onCheckedChange={(checked) => {
                if (checked) form.setValue('confirmed', true, { shouldValidate: true });
                else form.resetField('confirmed');
              }}
            />
            <FieldLabel
              htmlFor={'import-accepted-' + preview.id}
              className="min-h-11 items-start text-base leading-7"
            >
              我已核对正文、图片和来源，确认按上述范围导入私有草稿
            </FieldLabel>
          </div>
          <FieldError id={'import-accepted-error-' + preview.id}>
            {form.formState.errors.confirmed?.message}
          </FieldError>
        </Field>
        <FormNotice error={mutation.error} />
        <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onBack}>
            返回核对内容
          </Button>
          <SubmitButton
            pending={mutation.isPending}
            disabled={!confirmed || (target !== '__new' && (!current.data || current.isFetching))}
          >
            确认导入草稿
          </SubmitButton>
        </div>
      </form>
    </EditorSection>
  );
}
