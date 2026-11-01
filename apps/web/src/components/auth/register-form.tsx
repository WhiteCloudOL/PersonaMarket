'use client';
import { HydratedForm } from './hydrated-form';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { RegisterRequestSchema, canonicalJson } from '@personamarket/contracts';
import type { z } from 'zod';
import { FieldGroup } from '@personamarket/ui/components/field';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { AuthField, FormNotice, SubmitButton } from './auth-fields';
import { authApi, authQuery, ApiError } from '@/lib/auth-api';
import { useHydrationReady } from '@/lib/use-hydration-ready';

export function RegisterForm() {
  const hydrated = useHydrationReady();
  const availability = useQuery(authQuery);
  const form = useForm<z.infer<typeof RegisterRequestSchema>>({
    resolver: zodResolver(RegisterRequestSchema),
    defaultValues: { username: '', email: '', password: '' },
  });
  const mutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: (_result, input) => {
      if (canonicalJson(form.getValues()) === canonicalJson(input)) form.reset();
    },
    retry: false,
  });
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
  const closed = !settings.registrationAvailable;
  if (
    closed &&
    !form.formState.isDirty &&
    !mutation.isError &&
    !mutation.isPending &&
    !mutation.isSuccess
  )
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
  const conflict =
    mutation.error instanceof ApiError && mutation.error.code === 'REVISION_CONFLICT';
  return (
    <HydratedForm
      noValidate
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      className="flex flex-col gap-5"
    >
      {!mutation.isSuccess && (
        <p
          className="text-sm leading-7 text-muted-foreground"
          data-registration-mode={settings.registrationPolicy.verificationEmailTiming}
        >
          {settings.registrationPolicy.verificationEmailTiming === 'on_registration'
            ? '当前注册方式会安排发送验证邮件；未验证也可以先登录和编辑私有草稿'
            : '当前注册方式不自动发送验证邮件；可先登录，再到账号页主动申请。提交作品与公开互动等仍需验证邮箱'}
        </p>
      )}
      {closed && <FormNotice message="当前注册入口暂停，已填内容保留；已有账号可照常登录" />}
      {availability.isError && (
        <FormNotice error="无法核对当前注册设置，已填内容保留，请重新读取后再提交" />
      )}
      <fieldset
        disabled={mutation.isPending || availability.isError || availability.isFetching || closed}
        className="min-w-0 border-0 p-0"
      >
        <FieldGroup>
          <AuthField
            id="register-username"
            label="用户名"
            autoComplete="username"
            spellCheck={false}
            description="3 至 32 位字母、数字或下划线，以字母开头"
            {...form.register('username')}
            error={form.formState.errors.username?.message}
          />
          <AuthField
            id="register-email"
            label="邮箱"
            type="email"
            autoComplete="email"
            spellCheck={false}
            {...form.register('email')}
            error={form.formState.errors.email?.message}
          />
          <AuthField
            id="register-password"
            label="密码"
            type="password"
            autoComplete="new-password"
            description="12 至 64 个字符，可以使用较长的口令"
            {...form.register('password')}
            error={form.formState.errors.password?.message}
          />
        </FieldGroup>
      </fieldset>
      <FormNotice error={mutation.error} message={mutation.data?.data.message} />
      {mutation.isSuccess && (
        <p className="text-sm leading-7 text-muted-foreground">
          你可以先登录，未验证邮箱可编辑私有草稿；需要公开写入前，请在账号页完成邮箱验证
        </p>
      )}
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
        disabled={closed || availability.isError || availability.isFetching}
      >
        创建账号
      </SubmitButton>
      <p className="text-sm">
        已有账号？
        <Link href="/login" className="underline underline-offset-4">
          前往登录
        </Link>
      </p>
    </HydratedForm>
  );
}
