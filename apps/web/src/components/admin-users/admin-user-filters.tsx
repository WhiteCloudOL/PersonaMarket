'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AdminUsersQuerySchema } from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Badge } from '@personamarket/ui/components/badge';
import { AdminFilterLayout } from '../admin-filter-layout';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '@personamarket/ui/components/field';
import {
  AdminUserChoice,
  roleLabel,
  statusLabel,
  userRoles,
  userStatuses,
} from './admin-user-fields';

const FilterSchema = AdminUsersQuerySchema.omit({ page: true, pageSize: true });
export type UserFilters = z.infer<typeof FilterSchema>;
export function AdminUserFilters({
  initial,
  apply,
}: {
  initial: UserFilters;
  apply: (value: UserFilters) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const form = useForm<z.input<typeof FilterSchema>, unknown, UserFilters>({
    resolver: zodResolver(FilterSchema),
    defaultValues: {
      q: initial.q,
      role: initial.role,
      status: initial.status,
      sort: initial.sort,
      deactivation: initial.deactivation,
    },
  });
  const count = [
    initial.role !== 'all',
    initial.status !== 'all',
    initial.sort !== 'newest',
    initial.deactivation === 'pending',
  ].filter(Boolean).length;
  return (
    <form noValidate onSubmit={form.handleSubmit(apply)}>
      <FieldGroup>
        <AdminFilterLayout
          expanded={expanded}
          onExpandedChange={setExpanded}
          appliedCount={count}
          search={
            <Field data-invalid={Boolean(form.formState.errors.q)}>
              <FieldLabel htmlFor="admin-users-search">搜索用户</FieldLabel>
              <Input
                id="admin-users-search"
                type="search"
                autoComplete="off"
                spellCheck={false}
                placeholder="用户名、邮箱或完整账号 ID…"
                {...form.register('q')}
                aria-invalid={Boolean(form.formState.errors.q)}
              />
              <FieldError errors={[form.formState.errors.q]} />
            </Field>
          }
          common={
            <>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <AdminUserChoice
                    id="admin-users-role"
                    label="角色"
                    value={field.value ?? 'all'}
                    onChange={field.onChange}
                    options={[{ value: 'all', label: '全部角色' }, ...userRoles]}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <AdminUserChoice
                    id="admin-users-status"
                    label="账号状态"
                    value={field.value ?? 'all'}
                    onChange={field.onChange}
                    options={[{ value: 'all', label: '全部状态' }, ...userStatuses]}
                  />
                )}
              />
            </>
          }
          submit={
            <Button type="submit" className="h-auto min-h-11 whitespace-normal py-2">
              筛选用户
            </Button>
          }
        >
          <FieldDescription className="col-span-full flex flex-col gap-1">
            <span>查阅账号与管理记录，按明确范围处理角色、封禁和会话</span>
            <span>按用户名、邮箱或完整账号 ID 搜索，筛选条件保留在地址中</span>
          </FieldDescription>
          <Controller
            control={form.control}
            name="deactivation"
            render={({ field }) => (
              <AdminUserChoice
                id="admin-users-deactivation"
                label="停用申请"
                value={field.value ?? 'all'}
                onChange={field.onChange}
                options={[
                  { value: 'all', label: '全部申请状态' },
                  { value: 'pending', label: '待处理申请' },
                ]}
              />
            )}
          />
          <Controller
            control={form.control}
            name="sort"
            render={({ field }) => (
              <AdminUserChoice
                id="admin-users-sort"
                label="排序"
                value={field.value ?? 'newest'}
                onChange={field.onChange}
                options={[
                  { value: 'newest', label: '新注册优先' },
                  { value: 'oldest', label: '早注册优先' },
                  { value: 'username', label: '按用户名' },
                ]}
              />
            )}
          />
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-11 self-end whitespace-normal py-2"
            onClick={() => {
              const defaults = FilterSchema.parse({});
              form.reset(defaults);
              apply(defaults);
            }}
          >
            清空筛选
          </Button>
          <Button variant="outline" render={<Link href="/admin" />}>
            站点设置
          </Button>
        </AdminFilterLayout>
        {(initial.role !== 'all' ||
          initial.status !== 'all' ||
          initial.deactivation === 'pending') && (
          <div className="flex flex-wrap gap-2" aria-label="已应用的用户筛选">
            {initial.role !== 'all' && <Badge variant="secondary">{roleLabel(initial.role)}</Badge>}
            {initial.status !== 'all' && (
              <Badge variant="secondary">{statusLabel(initial.status)}</Badge>
            )}
            {initial.deactivation === 'pending' && <Badge variant="secondary">待处理申请</Badge>}
          </div>
        )}
      </FieldGroup>
    </form>
  );
}
