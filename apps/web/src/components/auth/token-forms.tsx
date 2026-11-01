'use client';
import { HydratedForm } from './hydrated-form';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { ForgotPasswordRequestSchema, ResetPasswordRequestSchema } from '@personamarket/contracts';
import type { z } from 'zod';
import { FieldGroup } from '@personamarket/ui/components/field';
import { AuthField, FormNotice, SubmitButton } from './auth-fields';
import { authApi } from '@/lib/auth-api';
import { useAuthRefresh } from './use-auth-change';
import { useMailToken, clearMailToken as clearToken } from '@/lib/mail-token';

export function ForgotPasswordForm() {
  const form = useForm<z.infer<typeof ForgotPasswordRequestSchema>>({
    resolver: zodResolver(ForgotPasswordRequestSchema),
    defaultValues: { email: '' },
  });
  const mutation = useMutation({
    mutationFn: (body: z.infer<typeof ForgotPasswordRequestSchema>) => authApi.forgot(body.email),
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
          id="forgot-email"
          label="注册邮箱"
          type="email"
          autoComplete="email"
          spellCheck={false}
          {...form.register('email')}
          error={form.formState.errors.email?.message}
        />
      </FieldGroup>
      <FormNotice error={mutation.error} message={mutation.data?.data.message} />
      <SubmitButton pending={mutation.isPending}>发送重置邮件</SubmitButton>
      <Link href="/login" className="text-sm underline underline-offset-4">
        返回登录
      </Link>
    </HydratedForm>
  );
}
export function VerifyEmailForm() {
  const refresh = useAuthRefresh();
  const token = useMailToken();
  const mutation = useMutation({
    mutationFn: () => authApi.verify(token),
    onSuccess: async () => {
      clearToken();
      await refresh();
    },
    retry: false,
  });
  return (
    <HydratedForm
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="flex flex-col gap-5"
    >
      <p className="text-sm text-muted-foreground">点击下方按钮确认邮箱，验证链接只可使用一次</p>
      <FormNotice error={mutation.error} message={mutation.data?.data.message} />
      {mutation.isSuccess && (
        <p className="text-sm leading-7 text-muted-foreground">
          邮箱已确认，请重新登录后继续使用账号
        </p>
      )}
      {mutation.isSuccess ? (
        <Link href="/login" className="underline underline-offset-4">
          前往登录
        </Link>
      ) : (
        <SubmitButton pending={mutation.isPending} disabled={!token}>
          验证邮箱
        </SubmitButton>
      )}
    </HydratedForm>
  );
}
const passwordSchema = ResetPasswordRequestSchema.pick({ password: true });
export function ResetPasswordForm() {
  const refresh = useAuthRefresh();
  const token = useMailToken();
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '' },
  });
  const mutation = useMutation({
    mutationFn: (body: z.infer<typeof passwordSchema>) => authApi.reset({ ...body, token }),
    onSuccess: async () => {
      clearToken();
      form.reset();
      await refresh();
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
          id="reset-password"
          label="新密码"
          type="password"
          autoComplete="new-password"
          description="12 至 64 个字符，重置后所有设备都需要重新登录"
          {...form.register('password')}
          error={form.formState.errors.password?.message}
        />
      </FieldGroup>
      <FormNotice error={mutation.error} message={mutation.data?.data.message} />
      {mutation.isSuccess ? (
        <Link href="/login" className="underline underline-offset-4">
          使用新密码登录
        </Link>
      ) : (
        <SubmitButton pending={mutation.isPending} disabled={!token}>
          重置密码
        </SubmitButton>
      )}
    </HydratedForm>
  );
}
