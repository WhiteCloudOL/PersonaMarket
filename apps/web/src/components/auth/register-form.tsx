'use client';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { RegisterRequestSchema } from '@personamarket/contracts';
import type { z } from 'zod';
import { FieldGroup } from '@personamarket/ui/components/field';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { AuthField, FormNotice, SubmitButton } from './auth-fields';
import { authApi, authQuery, ApiError } from '@/lib/auth-api';
import { EmailCodeField } from './email-code-field';
import { useHydrationReady } from '@/lib/use-hydration-ready';

export function RegisterForm() {
  const hydrated = useHydrationReady();
  const availability = useQuery(authQuery);
  const form = useForm<z.infer<typeof RegisterRequestSchema>>({
    resolver: zodResolver(RegisterRequestSchema),
    defaultValues: { username: '', email: '', password: '', code: '' },
  });
  const mutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: () => form.reset(),
    gcTime: 0,
    retry: false,
  });
  const send = useMutation({
    mutationFn: authApi.registrationCode,
    retry: false,
    onSuccess: () => {
      form.setValue('code', '', { shouldDirty: true });
      form.setFocus('code');
    },
  });
  async function requestCode() {
    if (await form.trigger('email')) send.mutate(form.getValues('email').trim().toLowerCase());
  }
  const settings = availability.data?.data;
  if (!hydrated || !settings)
    return (
      <div className="flex flex-col items-start gap-3">
        {!hydrated || availability.isPending ? (
          <p role="status">正在读取注册设置…</p>
        ) : (
          <>
            <FormNotice error="无法读取注册设置，请核对后重试" />
            <Button type="button" variant="outline" onClick={() => void availability.refetch()}>
              核对当前注册策略
            </Button>
          </>
        )}
      </div>
    );
  if (mutation.isSuccess)
    return (
      <div className="flex flex-col items-start gap-4">
        <FormNotice message={mutation.data.data.message} />
        <Link href="/login" className={buttonVariants()}>
          前往登录
        </Link>
      </div>
    );
  const closed = !settings.registrationAvailable;
  if (closed && !form.formState.isDirty && !mutation.isError && !mutation.isPending)
    return (
      <div className="flex flex-col items-start gap-3">
        <FormNotice message="注册暂未开放，请稍后再来" />
        <p className="text-sm leading-7 text-muted-foreground">
          已有账号可照常登录、找回密码或申请验证邮件
        </p>
        <Link href="/login" className={buttonVariants({ variant: 'outline' })}>
          登录已有账号
        </Link>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void availability.refetch()}
          disabled={availability.isFetching}
        >
          核对当前注册策略
        </Button>
      </div>
    );
  const fieldsDisabled = mutation.isPending || availability.isError || closed;
  const conflict =
    mutation.error instanceof ApiError && mutation.error.code === 'REVISION_CONFLICT';
  return (
    <form
      method="post"
      noValidate
      aria-busy={mutation.isPending || send.isPending}
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      className="flex flex-col gap-5"
    >
      <p className="text-sm leading-7 text-muted-foreground">
        获取 6 位邮箱验证码并在 10 分钟内提交，验证通过后即可创建账号
      </p>
      {closed && <FormNotice message="当前注册入口暂停，已填内容保留；已有账号可照常登录" />}
      {availability.isError && (
        <FormNotice error="无法核对当前注册设置，已填内容保留，请重新读取后再提交" />
      )}
      <FieldGroup>
        <AuthField
          id="register-username"
          disabled={fieldsDisabled}
          label="用户名"
          autoComplete="username"
          spellCheck={false}
          description="3 至 32 位字母、数字或下划线，以字母开头"
          {...form.register('username')}
          error={form.formState.errors.username?.message}
        />
        <AuthField
          id="register-email"
          disabled={fieldsDisabled}
          label="邮箱"
          type="email"
          autoComplete="email"
          spellCheck={false}
          readOnly={send.isPending}
          {...form.register('email', {
            onChange: () => {
              send.reset();
              form.setValue('code', '');
            },
          })}
          error={form.formState.errors.email?.message}
        />
        <AuthField
          id="register-password"
          disabled={fieldsDisabled}
          label="密码"
          type="password"
          autoComplete="new-password"
          description="12 至 64 个字符，可以使用较长的口令"
          {...form.register('password')}
          error={form.formState.errors.password?.message}
        />
        <EmailCodeField
          id="register-code"
          disabled={fieldsDisabled}
          field={form.register('code')}
          error={form.formState.errors.code?.message}
          sending={send.isPending}
          sent={send.isSuccess}
          onSend={() => void requestCode()}
        />
      </FieldGroup>
      <FormNotice error={mutation.error ?? send.error} message={send.data?.data.message} />
      {(conflict || availability.isError || closed) && (
        <Button
          type="button"
          variant="outline"
          disabled={availability.isFetching}
          onClick={() => void availability.refetch()}
        >
          核对当前注册策略
        </Button>
      )}
      <SubmitButton
        pending={mutation.isPending}
        disabled={closed || availability.isError || send.isPending}
      >
        创建账号
      </SubmitButton>
      <p className="text-sm">
        已有账号？
        <Link href="/login" className="underline underline-offset-4">
          前往登录
        </Link>
      </p>
    </form>
  );
}
