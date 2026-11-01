'use client';
import { useFormContext, useWatch } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import type { PersonaDraft } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@personamarket/ui/components/select';
import { Field, FieldLabel, FieldDescription } from '@personamarket/ui/components/field';
import { personasApi } from '@/lib/personas-api';
import { FormNotice } from '../auth/auth-fields';
const taxonomyQuery = { queryKey: ['site', 'taxonomy'], queryFn: personasApi.taxonomy };

export function CategoryField() {
  const form = useFormContext<PersonaDraft>();
  const taxonomy = useQuery(taxonomyQuery);
  const category = useWatch({ control: form.control, name: 'categoryId' });
  return (
    <Field>
      <FieldLabel id="category-label">主要分类</FieldLabel>
      <Select
        items={(taxonomy.data?.data.categories ?? []).map((item) => ({
          value: item.id,
          label: item.name,
        }))}
        value={category}
        onValueChange={(value) => form.setValue('categoryId', value, { shouldDirty: true })}
        disabled={taxonomy.isPending || taxonomy.isError}
      >
        <SelectTrigger aria-labelledby="category-label" className="h-11 w-full">
          <SelectValue placeholder="选择分类…" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {taxonomy.data?.data.categories.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

export function TagsField({ variant = 'choices' }: { variant?: 'choices' | 'select' }) {
  const form = useFormContext<PersonaDraft>();
  const taxonomy = useQuery(taxonomyQuery);
  const tagIds = useWatch({ control: form.control, name: 'tagIds' });
  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel id="tags-label">作品标签</FieldLabel>
        {variant === 'select' && (
          <span className="text-xs tabular-nums text-muted-foreground">{tagIds.length} / 8</span>
        )}
      </div>
      {taxonomy.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取分类与标签…
        </p>
      ) : taxonomy.isError ? (
        <div className="flex flex-col gap-2">
          <FormNotice error="无法读取分类与标签，请重试" />
          <Button type="button" variant="outline" onClick={() => void taxonomy.refetch()}>
            重试读取分类与标签
          </Button>
        </div>
      ) : taxonomy.data.data.tags.length && variant === 'select' ? (
        <Select
          multiple
          value={tagIds}
          items={taxonomy.data.data.tags.map((item) => ({ value: item.id, label: item.name }))}
          onValueChange={(value) => {
            if (value.length <= 8) form.setValue('tagIds', value, { shouldDirty: true });
          }}
        >
          <SelectTrigger aria-labelledby="tags-label" className="h-11 w-full min-w-0">
            <SelectValue placeholder="选择作品标签…" className="min-w-0 truncate" />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {taxonomy.data.data.tags.map((item) => (
                <SelectItem
                  key={item.id}
                  value={item.id}
                  disabled={tagIds.length >= 8 && !tagIds.includes(item.id)}
                >
                  {item.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : taxonomy.data.data.tags.length ? (
        <ToggleGroup
          multiple
          value={tagIds}
          aria-labelledby="tags-label"
          className="flex-wrap"
          variant="outline"
          onValueChange={(value) => {
            if (value.length <= 8)
              form.setValue('tagIds', value.map(String), { shouldDirty: true });
          }}
        >
          {taxonomy.data.data.tags.map((item) => (
            <ToggleGroupItem key={item.id} value={item.id}>
              {item.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : (
        <p className="text-sm text-muted-foreground">管理员添加标签后，可在这里选择</p>
      )}
      {variant === 'choices' && (
        <FieldDescription>可选，已选择 {tagIds.length} / 8 个标签</FieldDescription>
      )}
    </Field>
  );
}
