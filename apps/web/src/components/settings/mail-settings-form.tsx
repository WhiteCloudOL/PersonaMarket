'use client';
import { useState } from 'react';
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
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from '@personamarket/ui/components/field';
import { Switch } from '@personamarket/ui/components/switch';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@personamarket/ui/components/alert-dialog';
import { settingsApi } from '@/lib/settings-api';
import { AuthField, FormNotice, SubmitButton } from '../auth/auth-fields';
import { SettingsError } from './settings-error';
import { useSettingsDirty } from './settings-navigation';
import { isSettingsConflict, mergeSettings, sameSettings } from '@/lib/settings-save';
import { authQuery } from '@/lib/auth-api';
const key = ['private', 'settings', 'mail'] as const;
function values(data: MailSettingsResponse['data']): UpdateMailSettings {
  return data.mode === 'custom'
    ? {
        mode: 'custom',
        host: data.host,
        port: data.port,
        secure: data.secure,
        from: data.from,
        username: data.username,
        password: { action: 'keep' },
      }
    : { mode: data.mode };
}
function MailFields({ initial, saved }: { initial: MailSettingsResponse; saved: () => void }) {
  const client = useQueryClient();
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(initial);
  const data = snapshot.data;
  const form = useForm<UpdateMailSettings>({
    resolver: zodResolver(UpdateMailSettingsSchema),
    defaultValues: values(data),
  });
  const mode = useWatch({ control: form.control, name: 'mode' });
  const passwordAction = useWatch({ control: form.control, name: 'password.action' });
  const dirty = !sameSettings(useWatch({ control: form.control }), values(data));
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
      saved();
      client.setQueryData(key, result);
      await client.invalidateQueries({ queryKey: authQuery.queryKey });
    },
  });
  useSettingsDirty(dirty || save.isPending);
  const test = useMutation({ mutationFn: settingsApi.testMail, retry: false });
  const changeMode = (next: string) => {
    if (next === 'custom')
      form.reset(
        {
          mode: 'custom',
          host: data.host,
          port: data.port,
          secure: data.secure,
          from: data.from,
          username: data.username,
          password:
            data.mode === 'custom'
              ? { action: 'keep' }
              : data.username
                ? { action: 'replace', value: '' }
                : { action: 'clear' },
        },
        { keepDefaultValues: true },
      );
    else if (next === 'disabled' || next === 'environment')
      form.reset({ mode: next }, { keepDefaultValues: true });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>SMTP 连接与凭据</CardTitle>
        <CardDescription>保存后即时生效，生产始终校验证书并要求 TLS</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form
          noValidate
          onSubmit={form.handleSubmit((input) => save.mutate(input))}
          className="flex flex-col gap-5"
        >
          <fieldset
            disabled={save.isPending}
            className="flex min-w-0 flex-col gap-5 border-0 p-0"
            aria-label="邮件设置表单"
          >
            <FieldGroup>
              <FieldSet>
                <FieldLegend id="mail-mode-label">配置来源</FieldLegend>
                <ToggleGroup
                  value={[mode]}
                  onValueChange={(selected) => {
                    if (selected[0]) changeMode(String(selected[0]));
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
                  切换来源后保存才会生效，停用邮件会同时关闭注册入口
                </FieldDescription>
              </FieldSet>
              {mode === 'custom' ? (
                <>
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
                  <Controller
                    name="secure"
                    control={form.control}
                    render={({ field }) => (
                      <Field>
                        <FieldLabel htmlFor="smtp-secure">连接时立即使用 TLS</FieldLabel>
                        <Switch
                          id="smtp-secure"
                          checked={field.value === true}
                          onCheckedChange={field.onChange}
                        />
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
                  <FieldSet>
                    <FieldLegend id="smtp-password-action">SMTP 密码</FieldLegend>
                    <Controller
                      name="password.action"
                      control={form.control}
                      render={({ field }) => (
                        <ToggleGroup
                          value={[field.value ?? 'keep']}
                          onValueChange={(selected) => {
                            const action = selected[0];
                            if (action === 'replace')
                              form.setValue(
                                'password',
                                { action: 'replace', value: '' },
                                { shouldDirty: true },
                              );
                            else if (action === 'keep' || action === 'clear')
                              form.setValue('password', { action }, { shouldDirty: true });
                          }}
                          variant="outline"
                          aria-labelledby="smtp-password-action"
                          className="flex-wrap"
                        >
                          <ToggleGroupItem value="keep">保留已存密码</ToggleGroupItem>
                          <ToggleGroupItem value="replace">替换密码</ToggleGroupItem>
                          <ToggleGroupItem value="clear">清除密码</ToggleGroupItem>
                        </ToggleGroup>
                      )}
                    />
                    <FieldDescription>
                      {data.mode === 'custom' && data.passwordConfigured
                        ? '数据库密码已配置，无法读回'
                        : '数据库密码未配置，切换自定义认证时请提供新密码'}
                    </FieldDescription>
                  </FieldSet>
                  {passwordAction === 'replace' && (
                    <AuthField
                      id="smtp-password"
                      label="新的 SMTP 密码"
                      type="password"
                      autoComplete="new-password"
                      {...form.register('password.value')}
                      error={form.getFieldState('password.value', form.formState).error?.message}
                    />
                  )}
                </>
              ) : (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 break-all text-sm">
                  <dt>当前主机</dt>
                  <dd>{data.host || '未配置'}</dd>
                  <dt>当前端口</dt>
                  <dd>{data.port}</dd>
                  <dt>发件邮箱</dt>
                  <dd>{data.from || '未配置'}</dd>
                  <dt>部署密码</dt>
                  <dd>{data.passwordConfigured ? '已配置' : '未配置'}</dd>
                </dl>
              )}
            </FieldGroup>
            {dirty && (
              <p role="status" className="text-sm text-muted-foreground">
                有未保存的设置，保存后即时生效
              </p>
            )}
            <FormNotice error={save.error} />
            <div className="flex flex-wrap gap-3">
              <SubmitButton pending={save.isPending} disabled={!dirty}>
                保存邮件设置
              </SubmitButton>
              <AlertDialog open={defaultsOpen} onOpenChange={setDefaultsOpen}>
                <AlertDialogTrigger render={<Button type="button" variant="outline" />}>
                  恢复部署默认值
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>恢复部署配置</AlertDialogTitle>
                    <AlertDialogDescription>
                      配置来源将改为部署环境，自定义 SMTP
                      参数与数据库密码将在保存后清除，部署环境的凭据保持原样
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        changeMode('environment');
                        setDefaultsOpen(false);
                      }}
                    >
                      应用到表单
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </fieldset>
        </form>
        <FieldSet>
          <FieldLegend>真实测试邮件</FieldLegend>
          <FieldDescription>使用已保存的配置，只发送到当前管理员已验证邮箱</FieldDescription>
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
  const [saved, setSaved] = useState(false);
  if (query.isPending) return <p role="status">正在读取邮件配置…</p>;
  if (query.isError)
    return <SettingsError error={query.error} retry={() => void query.refetch()} />;
  return (
    <div className="flex flex-col gap-4">
      <FormNotice
        message={saved ? '上次修改已保存，API 和 Worker 将使用当前邮件配置' : undefined}
      />
      <MailFields initial={query.data} saved={() => setSaved(true)} />
    </div>
  );
}
