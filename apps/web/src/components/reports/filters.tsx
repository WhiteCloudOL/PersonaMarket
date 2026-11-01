'use client';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AdminReportsQuerySchema,
  IdSchema,
  type AdminReportsQuery,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Field, FieldGroup, FieldLabel, FieldError } from '@personamarket/ui/components/field';
import { ReportSelect } from './select';
import { reportStatuses, reportTypes } from './labels';

const FilterSchema = AdminReportsQuerySchema.extend({ id: z.union([IdSchema, z.literal('')]) });
const statuses = [
  { value: 'all', label: '全部状态' },
  ...Object.entries(reportStatuses).map(([value, label]) => ({ value, label })),
];
const types = [
  { value: 'all', label: '全部内容' },
  ...Object.entries(reportTypes).map(([value, label]) => ({ value, label })),
];
export function ReportFilters({
  mode,
  initial,
  apply,
}: {
  mode: 'own' | 'admin';
  initial: AdminReportsQuery;
  apply: (input: AdminReportsQuery) => void;
}) {
  const form = useForm<z.input<typeof FilterSchema>, unknown, z.output<typeof FilterSchema>>({
    resolver: zodResolver(FilterSchema),
    defaultValues: { ...initial, id: initial.id ?? '' },
  });
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(({ id, ...value }) =>
        apply({ ...value, ...(id ? { id } : {}), page: 1 }),
      )}
    >
      <FieldGroup
        className={
          mode === 'admin'
            ? 'grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]'
            : 'grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]'
        }
      >
        <Controller
          name="status"
          control={form.control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="report-filter-status">举报状态</FieldLabel>
              <ReportSelect
                id="report-filter-status"
                value={field.value ?? 'all'}
                onChange={field.onChange}
                options={statuses}
              />
            </Field>
          )}
        />
        {mode === 'admin' && (
          <>
            <Controller
              name="type"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="report-filter-type">举报内容</FieldLabel>
                  <ReportSelect
                    id="report-filter-type"
                    value={field.value ?? 'all'}
                    onChange={field.onChange}
                    options={types}
                  />
                </Field>
              )}
            />
            <Field data-invalid={Boolean(form.formState.errors.id)}>
              <FieldLabel htmlFor="report-filter-id">举报编号</FieldLabel>
              <Input
                id="report-filter-id"
                autoComplete="off"
                placeholder="按完整编号查找"
                aria-invalid={Boolean(form.formState.errors.id)}
                {...form.register('id')}
              />
              <FieldError errors={[form.formState.errors.id]} />
            </Field>
          </>
        )}
        <Button type="submit">筛选举报</Button>
      </FieldGroup>
    </form>
  );
}
