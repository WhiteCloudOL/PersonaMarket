'use client';
import { useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UpdateMailSettingsSchema,
  type MailSettingsResponse,
  type UpdateMailSettings,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from '@personamarket/ui/components/field';
import { Switch } from '@personamarket/ui/components/switch';
import { Input } from '@personamarket/ui/components/input';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import { settingsApi } from '@/lib/settings-api';
import { AuthField, FormNotice, SubmitButton } from '../auth/auth-fields';
import { SettingsError } from './settings-error';
import { useSettingsDirty } from './settings-navigation';
import { isSettingsConflict, mergeSettings, sameSettings } from '@/lib/settings-save';
import { authQuery } from '@/lib/auth-api';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
const key = ['private', 'settings', 'mail'] as const;
type CustomMailSettings = Extract<UpdateMailSettings, { mode: 'custom' }>;
const withinSettings = (target: URL, current: URL) =>
  target.origin === current.origin && target.pathname.startsWith('/admin/settings/');

function customValues(data: MailSettingsResponse['data']): CustomMailSettings {
  return {
    mode: 'custom',
    host: data.host,
    port: data.port,
    secure: data.secure,
    from: data.from,
    username: data.username,
    password: { action: 'keep' },
  };
}

function values(data: MailSettingsResponse['data']): UpdateMailSettings {
  return data.mode === 'custom' ? customValues(data) : { mode: data.mode };
}
function MailFields({ initial }: { initial: MailSettingsResponse }) {
  const client = useQueryClient();
  const customDraft = useRef<CustomMailSettings>(undefined);
  const [snapshot, setSnapshot] = useState(initial);
  const data = snapshot.data;
  const hasStoredPassword = data.mode === 'custom' && data.passwordConfigured;
  const form = useForm<UpdateMailSettings>({
    resolver: zodResolver(UpdateMailSettingsSchema),
    defaultValues: values(data),
  });
  const mode = useWatch({ control: form.control, name: 'mode' });
  const dirty = !sameSettings(useWatch({ control: form.control }), values(data));
  const test = useMutation({ mutationFn: settingsApi.testMail, retry: false });
  const save = useMutation({
    mutationFn: async (input: UpdateMailSettings) => {
      try {
        return await settingsApi.updateMail(input, snapshot.meta.revision);
      } catch (error) {
        if (!isSettingsConflict(error)) throw error;
        const latest = await settingsApi.mail();
        // SMTP 的密码不读回。配置发生并发写入时，由管理员确认后再保存。
        const merged = mergeSettings(values(data), input, values(latest.data));
        setSnapshot(latest);
        form.reset(merged.data);
        throw new Error('邮件设置同时被修改。当前输入已保留，确认后可再次点击保存。', {
          cause: error,
        });
      }
    },
    gcTime: 0,
    retry: false,
    onSuccess: async (result) => {
      setSnapshot(result);
      form.reset(values(result.data));
      customDraft.current = undefined;
      test.reset();
      client.setQueryData(key, result);
      await client.invalidateQueries({ queryKey: authQuery.queryKey });
    },
  });
  useSettingsDirty(dirty || save.isPending);
  useUnsavedDraft(dirty || save.isPending, '还有未保存的邮件设置，确定离开吗', withinSettings);
  function changeMode(next: UpdateMailSettings['mode'] | undefined) {
    const current = form.getValues();
    if (!next || current.mode === next) return;
    if (current.mode === 'custom') customDraft.current = current;
    if (next === 'custom') {
      form.reset(customDraft.current ?? customValues(data), { keepDefaultValues: true });
    } else {
      form.reset({ mode: next }, { keepDefaultValues: true });
    }
  }
  function submit(input: UpdateMailSettings) {
    if (input.mode === 'custom') {
      const hasPassword =
        input.password.action === 'replace' ||
        (input.password.action === 'keep' && hasStoredPassword);
      if (input.username && !hasPassword) {
        form.setError('password.value', { message: '请输入 SMTP 密码，或清空 SMTP 用户名' });
        form.setFocus('password');
        return;
      }
      if (!input.username && hasPassword) {
        form.setError(
          'username',
          { message: '请输入 SMTP 用户名，或清除密码' },
          { shouldFocus: true },
        );
        return;
      }
    }
    save.mutate(input);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>SMTP 连接与凭据</CardTitle>
        <CardDescription>保存后即时生效，生产始终校验证书并要求 TLS</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form noValidate onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-5">
          <fieldset
            disabled={save.isPending}
            className="min-w-0 border-0 p-0"
            aria-label="邮件设置表单"
          >
            <FieldGroup>
              <div
                className="flex min-w-0 flex-col gap-2"
                role="group"
                aria-labelledby="mail-mode-label"
              >
                <p id="mail-mode-label" className="font-medium">
                  配置来源
                </p>
                <ToggleGroup
                  value={[mode]}
                  onValueChange={(selected) => {
                    const next = selected[0];
                    if (next === 'custom' || next === 'environment' || next === 'disabled')
                      changeMode(next);
                  }}
                  variant="outline"
                  aria-labelledby="mail-mode-label"
                  className="flex-wrap"
                >
                  <ToggleGroupItem value="environment">继承部署配置</ToggleGroupItem>
                  <ToggleGroupItem value="custom">自定义 SMTP</ToggleGroupItem>
                  <ToggleGroupItem value="disabled">停用邮件</ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>
                  {data.mode === 'custom' && mode !== 'custom'
                    ? '保存后会移除已存的自定义 SMTP 配置与密码'
                    : '选择配置来源后，点击保存生效'}
                  {mode === 'disabled' && '，停用邮件也会关闭注册入口'}
                </FieldDescription>
              </div>
              {mode === 'custom' ? (
                <>
                  <div className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <AuthField
                      id="smtp-host"
                      label="SMTP 主机"
                      autoComplete="off"
                      {...form.register('host')}
                      error={form.getFieldState('host', form.formState).error?.message}
                    />
                    <AuthField
                      id="smtp-port"
                      label="SMTP 端口"
                      type="number"
                      min={1}
                      max={65535}
                      {...form.register('port', { valueAsNumber: true })}
                      error={form.getFieldState('port', form.formState).error?.message}
                    />
                  </div>
                  <Controller
                    name="secure"
                    control={form.control}
                    render={({ field }) => (
                      <Field>
                        <FieldLabel
                          htmlFor="smtp-secure"
                          className="min-h-11 items-center justify-between gap-4"
                        >
                          <span>连接时立即使用 TLS</span>
                          <Switch
                            id="smtp-secure"
                            checked={field.value === true}
                            onCheckedChange={field.onChange}
                          />
                        </FieldLabel>
                        <FieldDescription>
                          通常用于 465 端口，关闭时生产环境仍强制 STARTTLS
                        </FieldDescription>
                      </Field>
                    )}
                  />
                  <AuthField
                    id="smtp-from"
                    label="发件邮箱"
                    type="email"
                    autoComplete="off"
                    {...form.register('from')}
                    error={form.getFieldState('from', form.formState).error?.message}
                  />
                  <AuthField
                    id="smtp-user"
                    label="SMTP 用户名"
                    autoComplete="off"
                    {...form.register('username')}
                    error={form.getFieldState('username', form.formState).error?.message}
                    description="使用可信内部 relay 时，可同时清空用户名与密码"
                  />
                  <Controller
                    name="password"
                    control={form.control}
                    render={({ field }) => {
                      const password = field.value;
                      const clearing = password?.action === 'clear';
                      const replacing = password?.action === 'replace';
                      const error = form.getFieldState('password.value', form.formState).error;
                      return (
                        <Field data-invalid={Boolean(error)}>
                          <FieldLabel htmlFor="smtp-password">SMTP 密码</FieldLabel>
                          <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                            <Input
                              id="smtp-password"
                              name={field.name}
                              ref={field.ref}
                              type="password"
                              autoComplete="new-password"
                              spellCheck={false}
                              data-sensitive="password"
                              value={replacing ? password.value : ''}
                              onBlur={field.onBlur}
                              onChange={(event) => {
                                const value = event.target.value;
                                field.onChange(
                                  value ? { action: 'replace', value } : { action: 'keep' },
                                );
                                form.clearErrors('password');
                              }}
                              aria-invalid={Boolean(error)}
                              aria-describedby={
                                error
                                  ? 'smtp-password-help smtp-password-error'
                                  : 'smtp-password-help'
                              }
                            />
                            <Button
                              type="button"
                              variant="outline"
                              className="shrink-0"
                              disabled={save.isPending || !hasStoredPassword}
                              onClick={() => {
                                form.setValue(
                                  'password',
                                  { action: clearing ? 'keep' : 'clear' },
                                  { shouldDirty: true },
                                );
                                form.clearErrors('password');
                              }}
                            >
                              {clearing ? '撤销清除' : '清除密码'}
                            </Button>
                          </div>
                          <FieldDescription id="smtp-password-help">
                            {clearing
                              ? '保存时清除已存密码，停用 SMTP 认证时请同时清空用户名'
                              : hasStoredPassword
                                ? '密码已配置，留空保留，输入新密码后保存即可替换'
                                : '使用 SMTP 认证时请填写密码'}
                          </FieldDescription>
                          {error && (
                            <FieldError id="smtp-password-error">{error.message}</FieldError>
                          )}
                        </Field>
                      );
                    }}
                  />
                </>
              ) : (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 break-all text-sm">
                  <dt>当前主机</dt>
                  <dd>{data.host || '未配置'}</dd>
                  <dt>当前端口</dt>
                  <dd>{data.port}</dd>
                  <dt>发件邮箱</dt>
                  <dd>{data.from || '未配置'}</dd>
                  <dt>当前密码状态</dt>
                  <dd>{data.passwordConfigured ? '已配置' : '未配置'}</dd>
                </dl>
              )}
              {dirty && (
                <p role="status" className="text-sm text-muted-foreground">
                  有未保存的设置，保存后即时生效
                </p>
              )}
              <FormNotice
                error={save.error}
                message={
                  !dirty && save.isSuccess
                    ? '上次修改已保存，API 和 Worker 将使用当前邮件配置'
                    : undefined
                }
              />
              <div>
                <SubmitButton pending={save.isPending} disabled={!dirty || test.isPending}>
                  保存邮件设置
                </SubmitButton>
              </div>
            </FieldGroup>
          </fieldset>
        </form>
        <FieldSet className="border-t pt-4">
          <FieldLegend>真实测试邮件</FieldLegend>
          <FieldDescription>
            {dirty
              ? '请先保存邮件设置'
              : !data.configured
                ? '请先配置可用的邮件服务'
                : '使用已保存的配置向当前管理员的已验证邮箱发送测试邮件'}
          </FieldDescription>
          <Button
            variant="outline"
            disabled={test.isPending || save.isPending || dirty || !data.configured}
            onClick={() => test.mutate()}
          >
            {test.isPending ? '正在发送…' : '发送测试邮件'}
          </Button>
          <FormNotice error={test.error} message={test.data?.data.message} />
        </FieldSet>
      </CardContent>
    </Card>
  );
}
export function MailSettingsForm() {
  const query = useQuery({ queryKey: key, queryFn: settingsApi.mail, retry: false });
  if (query.isPending) return <p role="status">正在读取邮件配置…</p>;
  if (query.isError)
    return <SettingsError error={query.error} retry={() => void query.refetch()} />;
  return <MailFields initial={query.data} />;
}
