'use client';
import Link from 'next/link';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PublicBrandSchema, type PublicBrand } from '@personamarket/contracts';
import { FieldGroup } from '@personamarket/ui/components/field';
import { Button } from '@personamarket/ui/components/button';
import { authApi, authQuery } from '@/lib/auth-api';
import { AuthField, FormNotice, SubmitButton } from './auth-fields';
import { useSettingsForm } from '../settings/use-settings-form';
type BrandResponse = Awaited<ReturnType<typeof authApi.brand>>;
const brandKey = (accountId: string) => ['private', 'brand', accountId];
function BrandFields({ accountId, initial }: { accountId: string; initial: BrandResponse }) {
  const client = useQueryClient();
  const { form, save, busy, dirty, canSave, message, error } = useSettingsForm<
    PublicBrand,
    BrandResponse
  >({
    accountId,
    queryKey: brandKey(accountId),
    initial,
    resolver: zodResolver(PublicBrandSchema),
    valuesFor: (result) => result.data,
    read: authApi.brand,
    write: (value, base) => authApi.updateBrand(value, base.meta.revision),
    saved: '品牌设置已保存，首页将展示最新内容',
    onSaved: () => void client.invalidateQueries({ queryKey: ['public'] }),
  });
  return (
    <form noValidate onSubmit={form.handleSubmit(save)} className="flex flex-col gap-5">
      <fieldset
        disabled={busy}
        className="flex min-w-0 flex-col gap-5 border-0 p-0"
        aria-label="品牌设置表单"
      >
        <FieldGroup>
          <AuthField
            id="brand-name"
            label="站点名称"
            autoComplete="off"
            {...form.register('name')}
            error={form.formState.errors.name?.message}
          />
          <AuthField
            id="brand-description"
            label="站点简介"
            autoComplete="off"
            {...form.register('description')}
            error={form.formState.errors.description?.message}
          />
        </FieldGroup>
        <FormNotice message={dirty ? '有未保存的更改' : message} error={error} />
        <SubmitButton pending={busy} disabled={!canSave}>
          保存品牌设置
        </SubmitButton>
        <Link href="/" className="text-sm underline underline-offset-4">
          查看首页
        </Link>
      </fieldset>
    </form>
  );
}
export function AdminBrandForm() {
  const account = useQuery(authQuery);
  const accountId = account.data?.data.account?.id ?? '';
  const enabled =
    account.data?.data.account?.role === 'admin' && account.data.data.assurance === 'authenticated';
  const query = useQuery({
    queryKey: brandKey(accountId),
    queryFn: authApi.brand,
    enabled,
    retry: false,
  });
  if (account.isPending) return <p role="status">正在校验管理员身份…</p>;
  if (account.isError) return <FormNotice error="无法校验账号，请刷新后重试" />;
  if (account.data.data.account?.role !== 'admin')
    return <FormNotice error="此页面需要管理员权限" />;
  if (account.data.data.assurance !== 'authenticated')
    return (
      <Link href="/mfa" className="underline underline-offset-4">
        完成二次验证后继续
      </Link>
    );
  if (query.isPending) return <p role="status">正在读取品牌设置…</p>;
  if (query.isError)
    return (
      <div className="flex flex-col gap-4">
        <FormNotice error={query.error.message} />
        <Button variant="outline" onClick={() => void query.refetch()}>
          重试
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <BrandFields key={accountId} accountId={accountId} initial={query.data} />
    </div>
  );
}
