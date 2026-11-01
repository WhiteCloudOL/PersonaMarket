'use client';
import { HydratedForm } from './hydrated-form';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { LoginRequestSchema } from '@personamarket/contracts';
import type { z } from 'zod';
import { FieldGroup } from '@personamarket/ui/components/field';
import { AuthField, FormNotice, SubmitButton } from './auth-fields';
import { authApi } from '@/lib/auth-api';
import { useAuthChange } from './use-auth-change';
export function LoginForm({ returnTo }: { returnTo?: string | undefined }) {
  const changed = useAuthChange();
  const form = useForm<z.infer<typeof LoginRequestSchema>>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { identifier: '', password: '' },
  });
  const mutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: async () => {
      form.resetField('password');
      await changed(returnTo);
    },
    retry: false,
  });
  return (
    <HydratedForm
      noValidate
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      className="flex flex-col gap-5"
    >
      <FieldGroup>
        <AuthField
          id="login-identifier"
          label="用户名或邮箱"
          autoComplete="username"
          spellCheck={false}
          {...form.register('identifier')}
          error={form.formState.errors.identifier?.message}
        />
        <AuthField
          id="login-password"
          label="密码"
          type="password"
          autoComplete="current-password"
          {...form.register('password')}
          error={form.formState.errors.password?.message}
        />
      </FieldGroup>
      <FormNotice error={mutation.error} />
      <SubmitButton pending={mutation.isPending}>登录</SubmitButton>
      <div className="flex flex-wrap justify-between gap-3 text-sm">
        <Link href="/register" className="underline underline-offset-4">
          创建账号
        </Link>
        <Link href="/forgot-password" className="underline underline-offset-4">
          忘记密码
        </Link>
      </div>
    </HydratedForm>
  );
}
