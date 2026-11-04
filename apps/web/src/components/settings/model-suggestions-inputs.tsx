'use client';
import { useId } from 'react';
import { useSearchParams } from 'next/navigation';
import { Controller, useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import type { ModelSuggestionsWrite } from '@personamarket/contracts';
import { ArrowUpIcon, ArrowDownIcon, PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Switch } from '@personamarket/ui/components/switch';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { EditorSection } from '../personas/editor-section';

export function ModelSuggestionsInputs({
  form,
  disabled,
}: {
  form: UseFormReturn<Pick<ModelSuggestionsWrite, 'data'>>;
  disabled: boolean;
}) {
  const entries = useFieldArray({ control: form.control, name: 'data.entries' });
  const values = useWatch({ control: form.control, name: 'data.entries' });
  const search = useSearchParams().get('modelQuery') ?? '';
  function setSearch(value: string) {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set('modelQuery', value);
    else url.searchParams.delete('modelQuery');
    // 使用已安装 Next.js 支持的原生 History 同步 URL，定位不重新请求服务端列表
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  const searchId = useId();
  const needle = search.trim().toLowerCase();
  const indexes = entries.fields
    .map((_, index) => index)
    .filter((index) => {
      const row = values[index];
      return (
        !needle || Boolean(row && (row.modelId + '\n' + row.note).toLowerCase().includes(needle))
      );
    });
  return (
    <EditorSection
      title="建议列表"
      description="按顺序展示启用的建议，停用或移除不会改写作者已经填写的模型信息"
    >
      <Field>
        <FieldLabel htmlFor={searchId}>定位模型建议</FieldLabel>
        <Input
          id={searchId}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={disabled}
          autoComplete="off"
          placeholder="按模型标识或备注定位…"
        />
        <FieldDescription>
          共 {entries.fields.length} / 100 条，排序按钮按完整列表调整顺序
        </FieldDescription>
      </Field>
      {entries.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无模型建议，作者仍可自由填写模型名称</p>
      ) : indexes.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">没有匹配的模型建议</p>
          <Button type="button" variant="outline" disabled={disabled} onClick={() => setSearch('')}>
            清空定位条件
          </Button>
        </div>
      ) : (
        indexes.map((index) => {
          const row = entries.fields[index];
          if (!row) return null;
          return (
            <fieldset
              key={row.id}
              className="flex min-w-0 flex-col gap-4 rounded-xl border border-border p-4"
            >
              <legend className="px-2 text-sm font-medium">模型建议 {index + 1}</legend>
              {(['modelId', 'note'] as const).map((name) => {
                const id = 'suggestion-' + index + '-' + name;
                const error = form.formState.errors.data?.entries?.[index]?.[name];
                return (
                  <Field key={name} data-invalid={Boolean(error)}>
                    <FieldLabel htmlFor={id}>
                      建议 {index + 1} · {name === 'modelId' ? '模型标识' : '备注'}
                    </FieldLabel>
                    <Input
                      id={id}
                      {...form.register(`data.entries.${index}.${name}`)}
                      disabled={disabled}
                      autoComplete="off"
                      aria-invalid={Boolean(error)}
                      aria-describedby={id + '-help' + (error ? ' ' + id + '-error' : '')}
                    />
                    <FieldDescription id={id + '-help'}>
                      {Array.from(values[index]?.[name] ?? '').length} /{' '}
                      {name === 'modelId' ? 200 : 500} 字
                    </FieldDescription>
                    <FieldError id={id + '-error'} errors={[error]} />
                  </Field>
                );
              })}
              <Controller
                name={`data.entries.${index}.enabled`}
                control={form.control}
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <FieldLabel
                      htmlFor={'suggestion-enabled-' + index}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      启用模型建议 {index + 1}
                      <Switch
                        id={'suggestion-enabled-' + index}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={disabled}
                      />
                    </FieldLabel>
                  </Field>
                )}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  aria-label={'上移模型建议 ' + (index + 1)}
                  disabled={disabled || index === 0}
                  onClick={() => entries.move(index, index - 1)}
                >
                  <ArrowUpIcon aria-hidden />
                  上移
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={'下移模型建议 ' + (index + 1)}
                  disabled={disabled || index === entries.fields.length - 1}
                  onClick={() => entries.move(index, index + 1)}
                >
                  <ArrowDownIcon aria-hidden />
                  下移
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={'移除模型建议 ' + (index + 1)}
                  disabled={disabled}
                  onClick={() => entries.remove(index)}
                >
                  <XIcon aria-hidden />
                  移除
                </Button>
              </div>
            </fieldset>
          );
        })
      )}
      <FieldError
        errors={[form.formState.errors.data?.entries?.root ?? form.formState.errors.data?.entries]}
      />
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={disabled || entries.fields.length >= 100}
        onClick={() => {
          setSearch('');
          entries.append(
            { id: crypto.randomUUID(), modelId: '', note: '', enabled: true },
            { shouldFocus: true, focusName: `data.entries.${entries.fields.length}.modelId` },
          );
        }}
      >
        <PlusIcon aria-hidden />
        添加模型建议
      </Button>
    </EditorSection>
  );
}
