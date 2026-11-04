'use client';
import { useFormContext, useWatch } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import {
  CustomPersonaTagSchema,
  MAX_PERSONA_TAGS,
  type PersonaDraft,
} from '@personamarket/contracts';
import { useState } from 'react';
import { XIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
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

export function TagsField() {
  const form = useFormContext<PersonaDraft>();
  const taxonomy = useQuery(taxonomyQuery);
  const tagIds = useWatch({ control: form.control, name: 'tagIds' });
  const customTags = useWatch({ control: form.control, name: 'customTags' }) ?? [];
  const [input, setInput] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const tags = taxonomy.data?.data.tags ?? [];
  const count = tagIds.length + customTags.length;
  const search = input.trim().toLowerCase();
  const options = tags.filter(
    (tag) =>
      !tagIds.includes(tag.id) &&
      !customTags.some((name) => name.toLowerCase() === tag.name.toLowerCase()) &&
      tag.name.toLowerCase().includes(search),
  );
  const select = (id: string) => {
    if (count >= MAX_PERSONA_TAGS) return;
    form.setValue('tagIds', [...tagIds, id], { shouldDirty: true });
    setInput('');
    setError('');
  };
  const add = () => {
    if (count >= MAX_PERSONA_TAGS) return;
    const result = CustomPersonaTagSchema.safeParse(input);
    if (!result.success) {
      setError('请输入 1–24 个字符的标签');
      return;
    }
    const match = tags.find((tag) => tag.name.toLowerCase() === search);
    if (
      (match && tagIds.includes(match.id)) ||
      customTags.some((name) => name.toLowerCase() === search)
    ) {
      setError('这个标签已经添加');
      return;
    }
    if (match) select(match.id);
    else {
      form.setValue('customTags', [...customTags, result.data], { shouldDirty: true });
      setInput('');
      setError('');
    }
  };
  return (
    <Field data-invalid={Boolean(error)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldLabel htmlFor="draft-customTags">作品标签</FieldLabel>
        <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
          {count} / {MAX_PERSONA_TAGS}
        </span>
      </div>
      {count > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="已添加的标签">
          {tagIds.map((id) => {
            const name = tags.find((tag) => tag.id === id)?.name ?? '已有标签';
            return (
              <Button
                key={id}
                type="button"
                variant="secondary"
                className="h-auto min-h-11 max-w-full whitespace-normal"
                aria-label={`移除标签 ${name}`}
                onClick={() =>
                  form.setValue(
                    'tagIds',
                    tagIds.filter((tagId) => tagId !== id),
                    { shouldDirty: true },
                  )
                }
              >
                <span className="min-w-0 wrap-anywhere">{name}</span>
                <XIcon data-icon="inline-end" aria-hidden />
              </Button>
            );
          })}
          {customTags.map((name) => (
            <Button
              key={name}
              type="button"
              variant="secondary"
              className="h-auto min-h-11 max-w-full whitespace-normal"
              aria-label={`移除标签 ${name}`}
              onClick={() =>
                form.setValue(
                  'customTags',
                  customTags.filter((tag) => tag !== name),
                  { shouldDirty: true },
                )
              }
            >
              <span className="min-w-0 wrap-anywhere">{name}</span>
              <XIcon data-icon="inline-end" aria-hidden />
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <Input
          id="draft-customTags"
          name="persona-tag-input"
          autoComplete="off"
          aria-describedby="persona-tag-help"
          aria-invalid={Boolean(error)}
          placeholder="搜索或输入新标签…"
          value={input}
          disabled={count >= MAX_PERSONA_TAGS}
          className="min-h-11 min-w-0 flex-1 basis-36"
          onChange={(event) => {
            setInput(event.target.value);
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229)
              return;
            event.preventDefault();
            if (input.trim()) add();
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!input.trim() || count >= MAX_PERSONA_TAGS}
          onClick={add}
        >
          添加标签
        </Button>
      </div>
      <FieldDescription id="persona-tag-help">
        可选。选择推荐标签，或输入自定义标签后按回车。
      </FieldDescription>
      {error && <FormNotice error={error} />}
      {taxonomy.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取推荐标签…
        </p>
      )}
      {taxonomy.isError && (
        <Button type="button" variant="outline" onClick={() => void taxonomy.refetch()}>
          重试读取推荐标签
        </Button>
      )}
      {options.length > 0 && count < MAX_PERSONA_TAGS && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="推荐标签">
          {(expanded ? options : options.slice(0, 8)).map((tag) => (
            <Button
              key={tag.id}
              type="button"
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal"
              onClick={() => select(tag.id)}
            >
              <span className="min-w-0 wrap-anywhere">{tag.name}</span>
            </Button>
          ))}
          {options.length > 8 && (
            <Button
              type="button"
              variant="ghost"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? '收起推荐' : '更多推荐'}
            </Button>
          )}
        </div>
      )}
    </Field>
  );
}
