'use client';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AdminPersonasQuerySchema } from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
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
import { AdminFilterLayout } from '../admin-filter-layout';

const FilterSchema = AdminPersonasQuerySchema.omit({ page: true, pageSize: true });
export type PersonaFilters = z.infer<typeof FilterSchema>;
const choices = [
  {
    name: 'platform',
    label: '平台',
    options: [
      { value: 'all', label: '全部平台' },
      { value: 'maibot', label: 'MaiBot' },
      { value: 'astrbot', label: 'AstrBot' },
    ],
  },
  {
    name: 'state',
    label: '作品状态',
    options: [
      { value: 'all', label: '全部状态' },
      { value: 'public', label: '公开展示' },
      { value: 'unpublished', label: '未公开' },
      { value: 'pending', label: '待审核' },
      { value: 'hidden', label: '作者隐藏' },
      { value: 'blocked', label: '已下架' },
    ],
  },
  {
    name: 'official',
    label: '官方标记',
    options: [
      { value: 'all', label: '全部' },
      { value: 'true', label: '已标记' },
      { value: 'false', label: '未标记' },
    ],
  },
  {
    name: 'featured',
    label: '精选标记',
    options: [
      { value: 'all', label: '全部' },
      { value: 'true', label: '已标记' },
      { value: 'false', label: '未标记' },
    ],
  },
  {
    name: 'sort',
    label: '排序',
    options: [
      { value: 'updated', label: '最近更新' },
      { value: 'newest', label: '新近创建' },
      { value: 'oldest', label: '最早创建' },
    ],
  },
] as const;

export function AdminPersonaFilters({
  initial,
  apply,
}: {
  initial: PersonaFilters;
  apply: (input: PersonaFilters) => boolean | void;
}) {
  const [expanded, setExpanded] = useState(false);
  const form = useForm<z.input<typeof FilterSchema>, unknown, PersonaFilters>({
    resolver: zodResolver(FilterSchema),
    defaultValues: {
      q: initial.q,
      platform: initial.platform,
      state: initial.state,
      official: initial.official,
      featured: initial.featured,
      sort: initial.sort,
      ...(initial.ownerId ? { ownerId: initial.ownerId } : {}),
      ...(initial.categoryId ? { categoryId: initial.categoryId } : {}),
    },
  });
  const firstIdError = form.formState.errors.ownerId
    ? 'ownerId'
    : form.formState.errors.categoryId
      ? 'categoryId'
      : undefined;
  const { setFocus } = form;
  useEffect(() => {
    if (expanded && firstIdError) setFocus(firstIdError);
  }, [expanded, firstIdError, setFocus]);
  const count = [
    initial.platform !== 'all',
    initial.state !== 'all',
    initial.official !== 'all',
    initial.featured !== 'all',
    initial.sort !== 'updated',
    Boolean(initial.ownerId),
    Boolean(initial.categoryId),
  ].filter(Boolean).length;
  const choiceField = (choice: (typeof choices)[number]) => (
    <Controller
      key={choice.name}
      name={choice.name}
      control={form.control}
      render={({ field }) => (
        <Field>
          <FieldLabel htmlFor={'personas-filter-' + choice.name}>{choice.label}</FieldLabel>
          <Select
            items={[...choice.options]}
            value={field.value}
            onValueChange={(value) => {
              if (value) field.onChange(value);
            }}
          >
            <SelectTrigger id={'personas-filter-' + choice.name} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {choice.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      )}
    />
  );
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(apply, (errors) => {
        if (errors.ownerId || errors.categoryId) setExpanded(true);
      })}
    >
      <AdminFilterLayout
        expanded={expanded}
        onExpandedChange={setExpanded}
        appliedCount={count}
        search={
          <Field data-invalid={Boolean(form.formState.errors.q)}>
            <FieldLabel htmlFor="admin-personas-search">搜索人设</FieldLabel>
            <Input
              id="admin-personas-search"
              type="search"
              autoComplete="off"
              spellCheck={false}
              placeholder="作品名称、作者或完整作品 ID…"
              {...form.register('q')}
              aria-invalid={Boolean(form.formState.errors.q)}
            />
            <FieldError errors={[form.formState.errors.q]} />
          </Field>
        }
        common={
          <>
            {choices
              .filter((choice) => choice.name === 'platform' || choice.name === 'state')
              .map(choiceField)}
          </>
        }
        submit={
          <Button type="submit" className="h-auto min-h-11 whitespace-normal py-2">
            筛选人设
          </Button>
        }
      >
        <FieldDescription className="col-span-full flex flex-col gap-1">
          <span>按作者和状态核对作品，查看版本及管理标记</span>
          <span>私有正文在对应的审核页面按权限读取</span>
        </FieldDescription>
        {choices
          .filter((choice) => choice.name !== 'platform' && choice.name !== 'state')
          .map(choiceField)}
        {(['ownerId', 'categoryId'] as const).map((name) => (
          <Field key={name} data-invalid={Boolean(form.formState.errors[name])}>
            <FieldLabel htmlFor={'personas-filter-' + name}>
              {name === 'ownerId' ? '作者 ID' : '分类 ID'}
            </FieldLabel>
            <Input
              id={'personas-filter-' + name}
              autoComplete="off"
              spellCheck={false}
              placeholder="可留空…"
              {...form.register(name, {
                setValueAs: (value: unknown) =>
                  typeof value === 'string' ? value.trim() || undefined : value,
              })}
              aria-invalid={Boolean(form.formState.errors[name])}
            />
            <FieldError errors={[form.formState.errors[name]]} />
          </Field>
        ))}
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 self-end whitespace-normal py-2"
          onClick={() => {
            const defaults = FilterSchema.parse({});
            if (apply(defaults) !== false) form.reset(defaults);
          }}
        >
          清空筛选
        </Button>
      </AdminFilterLayout>
    </form>
  );
}
