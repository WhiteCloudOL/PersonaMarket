'use client';
import { Controller, useFormContext } from 'react-hook-form';
import type { AccountSettingsWrite } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Switch } from '@personamarket/ui/components/switch';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { Field, FieldGroup, FieldLabel } from '@personamarket/ui/components/field';
import { EditorSection } from '../personas/editor-section';
import { AuthField } from '../auth/auth-fields';

export function AccountSettingsInputs({
  advancedOpen,
  onAdvancedOpenChange,
}: {
  advancedOpen: boolean;
  onAdvancedOpenChange: (value: boolean) => void;
}) {
  const form = useFormContext<Pick<AccountSettingsWrite, 'data'>>();
  const errors = form.formState.errors;
  return (
    <>
      <EditorSection
        title="注册策略"
        description="新用户在注册页输入邮箱验证码后才能创建账号，关闭注册不影响已有账号登录和找回密码"
      >
        <FieldGroup>
          <Controller
            name="data.registrationEnabled"
            control={form.control}
            render={({ field }) => (
              <Field orientation="horizontal">
                <FieldLabel htmlFor="registration-enabled" className="min-h-11 items-center">
                  开放新用户注册
                </FieldLabel>
                <Switch
                  id="registration-enabled"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </Field>
            )}
          />
        </FieldGroup>
      </EditorSection>
      <Collapsible open={advancedOpen} onOpenChange={onAdvancedOpenChange}>
        <CollapsibleTrigger render={<Button type="button" variant="outline" />}>
          {advancedOpen ? '收起频率与会话设置' : '展开频率与会话设置'}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          <EditorSection
            title="频率与会话"
            description="业务注册限制不能超过固定保护，会话期限只用于之后创建的完整会话"
          >
            <FieldGroup>
              <FieldGroup className="md:grid md:grid-cols-2 md:items-start">
                <AuthField
                  id="registration-max-attempts"
                  label="每个 IP 的注册尝试次数"
                  type="number"
                  min={1}
                  max={10}
                  description="1 至 10 次，统计注册尝试而非成功账号数"
                  {...form.register('data.registrationRateLimit.maxAttempts', {
                    valueAsNumber: true,
                  })}
                  error={errors.data?.registrationRateLimit?.maxAttempts?.message}
                />
                <AuthField
                  id="registration-window"
                  label="注册业务窗口（秒）"
                  type="number"
                  min={60}
                  max={3600}
                  description="60 至 3600 秒；仍受固定每小时 10 次保护"
                  {...form.register('data.registrationRateLimit.windowSeconds', {
                    valueAsNumber: true,
                  })}
                  error={errors.data?.registrationRateLimit?.windowSeconds?.message}
                />
              </FieldGroup>
              <details className="min-w-0 text-sm text-muted-foreground">
                <summary className="flex min-h-11 cursor-pointer items-center">
                  查看注册计数口径
                </summary>
                <p className="leading-7">
                  开放注册时，按通过格式校验的注册尝试计数，后续失败仍计入。关闭注册后不扣业务窗口次数，但固定每小时保护仍在。同一窗口收紧次数不会清空计数，切回尚未过期的相同窗口继续使用原计数。修改会话期限不会重置注册额度，验证邮件和找回仍有独立保护。
                </p>
              </details>
              <AuthField
                id="session-ttl"
                label="新会话有效期（秒）"
                type="number"
                min={600}
                max={604800}
                description="600 至 604800 秒；已有完整会话不会因此改期，已绑定 MFA 的待验证会话仍限制为 10 分钟"
                {...form.register('data.sessionTtlSeconds', { valueAsNumber: true })}
                error={errors.data?.sessionTtlSeconds?.message}
              />
            </FieldGroup>
          </EditorSection>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
