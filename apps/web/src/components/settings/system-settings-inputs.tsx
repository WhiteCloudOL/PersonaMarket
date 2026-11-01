'use client';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import type { SystemSettingsWrite } from '@personamarket/contracts';
import { Switch } from '@personamarket/ui/components/switch';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { EditorSection } from '../personas/editor-section';

export function SystemSettingsInputs() {
  const form = useFormContext<SystemSettingsWrite>();
  const errors = form.formState.errors;
  const message = useWatch({ control: form.control, name: 'data.maintenanceMessage' });
  return (
    <>
      <EditorSection
        title="维护设置"
        description="拒绝新普通业务提交，保留登录、账号恢复和有权限的管理操作"
      >
        <FieldGroup>
          <Controller
            name="data.maintenanceEnabled"
            control={form.control}
            render={({ field }) => (
              <Field
                orientation="horizontal"
                data-invalid={Boolean(errors.data?.maintenanceEnabled)}
              >
                <FieldLabel htmlFor="maintenance-enabled" className="min-h-11 items-center">
                  开启维护模式
                </FieldLabel>
                <Switch
                  id="maintenance-enabled"
                  name={field.name}
                  ref={field.ref}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  onBlur={field.onBlur}
                  aria-invalid={Boolean(errors.data?.maintenanceEnabled)}
                />
                <FieldError>{errors.data?.maintenanceEnabled?.message}</FieldError>
              </Field>
            )}
          />
          <Field data-invalid={Boolean(errors.data?.maintenanceMessage)}>
            <FieldLabel htmlFor="maintenance-message" className="flex-wrap justify-between gap-2">
              <span>公共维护提示</span>
              <span aria-hidden="true" className="text-sm font-normal text-muted-foreground">
                {Array.from(message).length} / 500
              </span>
            </FieldLabel>
            <Textarea
              id="maintenance-message"
              {...form.register('data.maintenanceMessage')}
              autoComplete="off"
              className="min-h-28"
              aria-invalid={Boolean(errors.data?.maintenanceMessage)}
              aria-describedby="maintenance-message-help maintenance-message-error"
            />
            <FieldDescription id="maintenance-message-help">
              只在维护开启时公开显示，关闭后保留配置；留空使用默认维护提示，仅支持纯文本
            </FieldDescription>
            <FieldError id="maintenance-message-error">
              {errors.data?.maintenanceMessage?.message}
            </FieldError>
          </Field>
          <details className="min-w-0 text-sm text-muted-foreground">
            <summary className="flex min-h-11 cursor-pointer items-center">
              查看维护影响范围
            </summary>
            <p className="leading-7">
              创作、导入、上传、互动等新普通提交会被拒绝，管理员通过创作者入口操作也受限制；实际下载会记账，维护时停止发送文件，预览与其他读取仍按原权限处理
            </p>
            <p className="mt-3 leading-7">
              登录、账号安全恢复和有权限的管理命令继续，已排队任务与必要补偿不会自动停止；维护开关不能代替一致性备份所需的停写流程
            </p>
          </details>
        </FieldGroup>
      </EditorSection>
      <Field data-invalid={Boolean(errors.reason)}>
        <FieldLabel htmlFor="system-settings-reason">处理理由</FieldLabel>
        <Textarea
          id="system-settings-reason"
          autoComplete="off"
          {...form.register('reason')}
          aria-invalid={Boolean(errors.reason)}
          aria-describedby="system-settings-reason-error"
        />
        <FieldError id="system-settings-reason-error">{errors.reason?.message}</FieldError>
      </Field>
    </>
  );
}
