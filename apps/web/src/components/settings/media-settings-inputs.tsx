'use client';
import { useId, useState } from 'react';
import { Controller, useWatch, type UseFormReturn } from 'react-hook-form';
import type { MediaSettingsWrite } from '@personamarket/contracts';
import { Switch } from '@personamarket/ui/components/switch';
import { Input } from '@personamarket/ui/components/input';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Button } from '@personamarket/ui/components/button';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldSet,
  FieldLegend,
} from '@personamarket/ui/components/field';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { EditorSection } from '../personas/editor-section';

export function MediaSettingsInputs({
  form,
  disabled,
}: {
  form: UseFormReturn<MediaSettingsWrite>;
  disabled: boolean;
}) {
  const id = useId();
  const values = useWatch({ control: form.control, name: 'data' });
  const amount = (value: number) => (Number.isFinite(value) ? value : '未填写');
  const [limitsOpen, setLimitsOpen] = useState(false),
    [domainsOpen, setDomainsOpen] = useState(false);
  const numeric = [
    {
      name: 'maxImageKiB',
      label: '单张原图上限（KiB）',
      min: 64,
      max: 5120,
      help: '按原始上传字节校验，最大 5 MiB；转换后的文件计入账号存储预算',
    },
    {
      name: 'maxImagesPerAccount',
      label: '每账号素材数量上限',
      min: 1,
      max: 100,
      help: '包含作品、证据、头像及通用包暂存图片，最多 100 张',
    },
    {
      name: 'maxStorageMiBPerAccount',
      label: '每账号存储预算（MiB）',
      min: 1,
      max: 100,
      help: '正式素材与暂存图片合计，最多 100 MiB；不会删除已有文件',
    },
    {
      name: 'maxReadmeImages',
      label: '新版本 README 图片上限',
      min: 0,
      max: 20,
      help: '按实际图片语法计数，重复引用也计数；头像与封面另计',
    },
    {
      name: 'maxConcurrentImports',
      label: '在途在线导入上限',
      min: 1,
      max: 3,
      help: '普通图片与通用包图片的排队、处理任务合计；收紧不删除已接受任务，新入队和重试按新预算',
    },
  ] as const;
  const limitsExpanded =
    limitsOpen || numeric.some((field) => Boolean(form.formState.errors.data?.[field.name]));
  const domainsExpanded = domainsOpen || Boolean(form.formState.errors.data?.sourceDomains);
  return (
    <>
      <EditorSection
        title="图片来源"
        description="开关作用于上传与在线托管，已有素材仍可读取和引用"
      >
        <FieldGroup>
          {(
            [
              {
                name: 'uploadsEnabled',
                label: '允许本地图片上传',
                help: '包括作品图片、头像、私有证据与完整 ZIP 内图',
              },
              {
                name: 'remoteImportsEnabled',
                label: '允许在线图片导入',
                help: '由 API 和 Worker 校验当前策略，关闭后在途下载不能继续保存新素材',
              },
            ] as const
          ).map((item) => (
            <Controller
              key={item.name}
              control={form.control}
              name={('data.' + item.name) as `data.${typeof item.name}`}
              render={({ field }) => (
                <Field orientation="horizontal">
                  <Switch
                    id={id + '-' + item.name}
                    name={field.name}
                    ref={field.ref}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    onBlur={field.onBlur}
                    disabled={disabled}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <FieldLabel htmlFor={id + '-' + item.name} className="min-h-11">
                      {item.label}
                    </FieldLabel>
                    <FieldDescription>{item.help}</FieldDescription>
                  </div>
                </Field>
              )}
            />
          ))}
        </FieldGroup>
      </EditorSection>
      <EditorSection
        title="容量与数量"
        description="只收紧现有上限，旧公开内容和草稿不会被截断，未完成预览可能需要重新核对"
      >
        <p className="text-sm text-muted-foreground">
          原图 {amount(values.maxImageKiB)} KiB · 每账号 {amount(values.maxImagesPerAccount)} 张 /{' '}
          {amount(values.maxStorageMiBPerAccount)} MiB · 新版本 README{' '}
          {amount(values.maxReadmeImages)} 张
        </p>
        <Collapsible open={limitsExpanded} onOpenChange={setLimitsOpen}>
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                className="h-auto min-h-11 max-w-full py-2 whitespace-normal"
              />
            }
          >
            {limitsExpanded ? '收起容量与数量' : '调整容量与数量'}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-5">
            <FieldSet>
              <FieldLegend className="sr-only">图片容量与数量限制</FieldLegend>
              {numeric.map((item) => (
                <Field
                  key={item.name}
                  data-invalid={Boolean(form.formState.errors.data?.[item.name])}
                >
                  <FieldLabel htmlFor={id + '-' + item.name}>{item.label}</FieldLabel>
                  <Input
                    id={id + '-' + item.name}
                    type="number"
                    inputMode="numeric"
                    autoComplete="off"
                    min={item.min}
                    max={item.max}
                    step={1}
                    disabled={disabled}
                    aria-invalid={Boolean(form.formState.errors.data?.[item.name])}
                    {...form.register(`data.${item.name}`, { valueAsNumber: true })}
                  />
                  <FieldDescription>{item.help}</FieldDescription>
                  <FieldError errors={[form.formState.errors.data?.[item.name]]} />
                </Field>
              ))}
            </FieldSet>
          </CollapsibleContent>
        </Collapsible>
      </EditorSection>
      <EditorSection title="在线来源域" description="可选的来源范围，每个跳转目标都需符合当前配置">
        <p className="text-sm text-muted-foreground">
          {values.sourceDomains.some((domain) => domain.trim())
            ? `当前输入 ${values.sourceDomains.filter((domain) => domain.trim()).length} 个来源域，按精确域名匹配`
            : '不另限制来源域名，公网 HTTPS 与文件校验继续执行'}
        </p>
        <Collapsible open={domainsExpanded} onOpenChange={setDomainsOpen}>
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                className="h-auto min-h-11 max-w-full py-2 whitespace-normal"
              />
            }
          >
            {domainsExpanded ? '收起来源域限制' : '调整来源域限制'}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-5">
            <Controller
              control={form.control}
              name="data.sourceDomains"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={id + '-domains'}>允许的图片来源域</FieldLabel>
                  <Textarea
                    id={id + '-domains'}
                    ref={field.ref}
                    name={field.name}
                    value={field.value.join('\n')}
                    onChange={(event) =>
                      field.onChange(event.target.value ? event.target.value.split(/\r?\n/u) : [])
                    }
                    onBlur={field.onBlur}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={disabled}
                    aria-invalid={fieldState.invalid}
                    className="max-h-[40dvh] min-h-32 overflow-y-auto"
                  />
                  <FieldDescription>
                    每行一个域名，最多 50
                    个；留空不另限制域名。精确匹配，不包含子域；支持国际化域名，不接受协议、路径、端口、IP
                    或通配符。保存时忽略空行
                  </FieldDescription>
                  <FieldError>
                    {fieldState.invalid
                      ? (fieldState.error?.message ?? '请逐行核对域名，避免重复或包含地址路径')
                      : undefined}
                  </FieldError>
                </Field>
              )}
            />
          </CollapsibleContent>
        </Collapsible>
      </EditorSection>
    </>
  );
}
