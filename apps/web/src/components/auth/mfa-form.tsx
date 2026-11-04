'use client';
import { HydratedForm } from './hydrated-form';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MfaCodeRequestSchema, type MfaSetupResponseSchema } from '@personamarket/contracts';
import type { z } from 'zod';
import { FieldGroup } from '@personamarket/ui/components/field';
import { Button } from '@personamarket/ui/components/button';
import { AuthField, FormNotice, SubmitButton } from './auth-fields';
import { authApi, authQuery } from '@/lib/auth-api';
import { useAuthChange } from './use-auth-change';
import { announceAuthSession } from '@/lib/auth-session-events';

export function MfaForm({
  mode,
  returnTo,
}: {
  mode: 'auto' | 'setup' | 'verify' | 'manage';
  returnTo?: string | undefined;
}) {
  const context = useQuery(authQuery);
  const client = useQueryClient();
  const changed = useAuthChange();
  const [enrollment, setEnrollment] = useState<
    z.infer<typeof MfaSetupResponseSchema>['data'] | null
  >(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copyNotice, setCopyNotice] = useState('');
  const form = useForm<z.infer<typeof MfaCodeRequestSchema>>({
    resolver: zodResolver(MfaCodeRequestSchema),
    defaultValues: { code: '' },
  });
  const setup = useMutation({
    mutationFn: authApi.setup,
    onSuccess: (result) => setEnrollment(result.data),
    retry: false,
  });
  const confirm = useMutation({
    mutationFn: authApi.confirm,
    onSuccess: async (result) => {
      setEnrollment(null);
      setCodes(result.data.recoveryCodes);
      form.reset();
      await client.invalidateQueries({ queryKey: authQuery.queryKey });
    },
    retry: false,
  });
  const verify = useMutation({
    mutationFn: authApi.mfa,
    onSuccess: async () => {
      if (mode !== 'manage') return changed(returnTo);
      form.reset();
      await client.invalidateQueries({ queryKey: authQuery.queryKey });
      announceAuthSession();
    },
    retry: false,
  });
  if (context.isPending) return <p role="status">正在读取二次验证状态…</p>;
  if (context.isError) return <FormNotice error="无法读取账号状态，请刷新后重试" />;
  if (!context.data.data.account)
    return (
      <Link href="/login" className="underline underline-offset-4">
        请先登录
      </Link>
    );
  if (codes)
    return (
      <div className="flex flex-col gap-5">
        <h2 className="font-medium">安全保存一次性恢复码</h2>
        <p className="text-sm text-muted-foreground">
          每个恢复码仅可使用一次，请离线妥善保存，离开此页后不再显示
        </p>
        <ul aria-label="一次性恢复码" className="flex flex-col gap-2 text-xs">
          {codes.map((code) => (
            <li key={code}>
              <code className="break-all">{code}</code>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(codes.join('\n'));
              setCopyNotice('恢复码已复制，请安全保存');
            } catch {
              setCopyNotice('复制失败，请手动保存恢复码');
            }
          }}
        >
          复制恢复码
        </Button>
        <p role="status" className="text-sm">
          {copyNotice}
        </p>
        <Button onClick={() => (mode === 'manage' ? setCodes(null) : void changed(returnTo))}>
          已安全保存，继续
        </Button>
      </div>
    );
  const needSetup =
    mode === 'setup' ||
    context.data.data.assurance === 'mfa_setup' ||
    (mode === 'manage' && !context.data.data.mfaEnabled);
  if (needSetup && !enrollment)
    return (
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">
          使用身份验证器扫描二维码，绑定后登录需要动态验证码或恢复码
        </p>
        <FormNotice error={setup.error} />
        <Button disabled={setup.isPending} onClick={() => setup.mutate()}>
          {setup.isPending ? '正在准备…' : '开始绑定身份验证器'}
        </Button>
      </div>
    );
  return (
    <HydratedForm
      noValidate
      onSubmit={form.handleSubmit((values) =>
        enrollment ? confirm.mutate(values.code) : verify.mutate(values.code),
      )}
      className="flex flex-col gap-5"
    >
      {enrollment && (
        <div className="flex flex-col items-start gap-3">
          <Image
            src={enrollment.qrDataUrl}
            width={240}
            height={240}
            unoptimized
            alt="使用身份验证器扫描此二维码"
          />
          <p className="text-sm text-muted-foreground">无法扫码时，可手动录入此密钥</p>
          <code className="max-w-full break-all" data-sensitive="mfa-secret">
            {enrollment.secret}
          </code>
        </div>
      )}
      <FieldGroup>
        <AuthField
          id="mfa-code"
          label={enrollment ? '六位动态验证码' : '动态验证码或恢复码'}
          autoComplete="one-time-code"
          spellCheck={false}
          inputMode={enrollment ? 'numeric' : 'text'}
          {...form.register('code')}
          error={form.formState.errors.code?.message}
        />
      </FieldGroup>
      <FormNotice
        error={confirm.error ?? verify.error}
        message={mode === 'manage' && verify.isSuccess ? '已重新验证身份' : undefined}
      />
      <SubmitButton pending={confirm.isPending || verify.isPending}>
        {enrollment ? '确认绑定' : '完成二次验证'}
      </SubmitButton>
    </HydratedForm>
  );
}
