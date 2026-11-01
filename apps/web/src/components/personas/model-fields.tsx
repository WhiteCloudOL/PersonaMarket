'use client';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PersonaDraft } from '@personamarket/contracts';
import { PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import { DraftText, EditorSection } from './draft-fields';
import { Field, FieldLabel, FieldDescription } from '@personamarket/ui/components/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@personamarket/ui/components/select';
import { publicModelSuggestionsQuery } from '@/lib/model-suggestions-api';
import { FormNotice } from '../auth/auth-fields';
export function RecommendedModelsFields({ step = '06' }: { step?: string }) {
  const form = useFormContext<PersonaDraft>();
  const models = useFieldArray({ control: form.control, name: 'recommendedModels' });
  const suggestions = useQuery(publicModelSuggestionsQuery);
  const [selection, setSelection] = useState<string | null>(null);
  const [message, setMessage] = useState<string>();
  return (
    <EditorSection
      id="recommended-models"
      step={step}
      title="推荐模型"
      description="可选填写实际使用过的模型与建议，最多 5 条"
    >
      <Field>
        <FieldLabel id="model-suggestions-label">站点模型建议</FieldLabel>
        {suggestions.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            正在读取模型建议…
          </p>
        ) : suggestions.isError ? (
          <div className="flex flex-col items-start gap-3">
            <FormNotice error="模型建议暂时无法读取，你仍可自由填写" />
            <Button type="button" variant="outline" onClick={() => void suggestions.refetch()}>
              重试模型建议
            </Button>
          </div>
        ) : suggestions.data.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无站点建议，可直接添加自己的模型信息</p>
        ) : (
          <Select
            items={suggestions.data.data.map((entry) => ({
              value: entry.id,
              label: entry.modelId,
            }))}
            value={selection}
            disabled={models.fields.length >= 5}
            onValueChange={(value) => {
              setSelection(value);
              const selected = suggestions.data.data.find((entry) => entry.id === value);
              if (!selected || models.fields.length >= 5) return;
              if (
                form
                  .getValues('recommendedModels')
                  .some((entry) => entry.modelId.toLowerCase() === selected.modelId.toLowerCase())
              )
                setMessage('这条建议已在当前表单中，可继续编辑');
              else {
                models.append({ modelId: selected.modelId, note: selected.note });
                setMessage('已添加模型建议，可继续修改标识和备注');
              }
              setSelection(null);
            }}
          >
            <SelectTrigger
              aria-labelledby="model-suggestions-label"
              aria-describedby="model-suggestions-help"
              className="w-full min-w-0"
            >
              <SelectValue placeholder="选择一条建议并添加…" />
            </SelectTrigger>
            <SelectContent className="max-w-[calc(100vw-2rem)]">
              <SelectGroup>
                {suggestions.data.data.map((entry) => (
                  <SelectItem
                    key={entry.id}
                    value={entry.id}
                    className="[&>[data-slot=select-item-text]]:min-w-0 [&>[data-slot=select-item-text]]:shrink [&>[data-slot=select-item-text]]:whitespace-normal"
                  >
                    <span className="min-w-0 [overflow-wrap:anywhere]">{entry.modelId}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
        <FieldDescription id="model-suggestions-help">
          选择后只追加到当前表单，也可自由填写，不连接模型供应商
        </FieldDescription>
      </Field>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {models.fields.length > 0 && (
        <div className="grid min-w-0 gap-4 @min-[44rem]/field-group:grid-cols-2">
          {models.fields.map((field, index) => (
            <div
              key={field.id}
              className="relative flex min-w-0 flex-col gap-4 rounded-xl border bg-background/60 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">模型推荐 {index + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => models.remove(index)}
                  aria-label={`移除推荐模型 ${index + 1}`}
                >
                  <XIcon aria-hidden />
                </Button>
              </div>
              <DraftText
                name={`recommendedModels.${index}.modelId`}
                label={`模型 ${index + 1} · 标识`}
                limit={200}
              />
              <DraftText
                name={`recommendedModels.${index}.note`}
                label={`模型 ${index + 1} · 备注`}
                limit={500}
              />
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={models.fields.length >= 5}
        onClick={() => models.append({ modelId: '', note: '' })}
      >
        <PlusIcon aria-hidden />
        添加推荐模型
      </Button>
    </EditorSection>
  );
}
