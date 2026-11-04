'use client';
import { useId, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import {
  TransferImportFormatSchema,
  ExportFormatSchema,
  type TransferSettingsWrite,
} from '@personamarket/contracts';
import { Switch } from '@personamarket/ui/components/switch';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Input } from '@personamarket/ui/components/input';
import { Button } from '@personamarket/ui/components/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldSet,
  FieldLegend,
} from '@personamarket/ui/components/field';
import { EditorSection } from '../personas/editor-section';
import { transferFormatLabels } from './transfer-settings-summary';

export function TransferSettingsInputs({
  form,
  disabled,
}: {
  form: UseFormReturn<Pick<TransferSettingsWrite, 'data'>>;
  disabled: boolean;
}) {
  const id = useId();
  const [limitsOpen, setLimitsOpen] = useState(false);
  return (
    <>
      <EditorSection
        title="访客下载"
        description="只影响站点的导出预览和文件下载，公开正文仍可阅读和手动复制"
      >
        <Controller
          control={form.control}
          name="data.guestExportsEnabled"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch
                id={id + '-guest'}
                name={field.name}
                ref={field.ref}
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
                disabled={disabled}
              />
              <FieldLabel htmlFor={id + '-guest'} className="min-h-11 flex-1">
                允许未登录访客导出
              </FieldLabel>
            </Field>
          )}
        />
      </EditorSection>
      <EditorSection
        title="文件格式"
        description="关闭格式后不再接受新导入或下载，旧预览仍可读取和取消"
      >
        <Tabs defaultValue="import">
          <TabsList>
            <TabsTrigger value="import" className="min-h-11">
              导入格式
            </TabsTrigger>
            <TabsTrigger value="export" className="min-h-11">
              导出格式
            </TabsTrigger>
          </TabsList>
          {(['import', 'export'] as const).map((kind) => (
            <TabsContent key={kind} value={kind} keepMounted>
              <Controller
                control={form.control}
                name={kind === 'import' ? 'data.importFormats' : 'data.exportFormats'}
                render={({ field, fieldState }) => {
                  const formats =
                    kind === 'import'
                      ? TransferImportFormatSchema.options
                      : ExportFormatSchema.options;
                  return (
                    <FieldSet data-invalid={fieldState.invalid} className="gap-3">
                      <FieldLegend className="sr-only">
                        {kind === 'import' ? '导入格式' : '导出格式'}
                      </FieldLegend>
                      <div className="grid min-w-0 gap-x-6 sm:grid-cols-2">
                        {formats.map((format) => (
                          <Field orientation="horizontal" key={format}>
                            <Checkbox
                              id={id + '-' + kind + '-' + format}
                              name={field.name}
                              checked={field.value.some((key) => key === format)}
                              disabled={disabled}
                              onCheckedChange={(checked) => {
                                field.onChange(
                                  formats.filter((key) =>
                                    key === format
                                      ? checked === true
                                      : field.value.some((selected) => selected === key),
                                  ),
                                );
                              }}
                              onBlur={field.onBlur}
                            />
                            <FieldLabel
                              htmlFor={id + '-' + kind + '-' + format}
                              className="min-h-11 flex-1 [overflow-wrap:anywhere]"
                            >
                              {transferFormatLabels[format]}
                            </FieldLabel>
                          </Field>
                        ))}
                      </div>
                      <FieldDescription>
                        {field.value.length
                          ? `已启用 ${field.value.length} 种格式`
                          : '全部关闭，保存前需要确认'}
                      </FieldDescription>
                      <FieldError errors={[fieldState.error]} />
                    </FieldSet>
                  );
                }}
              />
            </TabsContent>
          ))}
        </Tabs>
        <Collapsible
          open={
            limitsOpen ||
            Boolean(
              form.formState.errors.data?.maxImportFileKiB ||
              form.formState.errors.data?.maxImportArchiveMiB,
            )
          }
          onOpenChange={setLimitsOpen}
        >
          <CollapsibleTrigger
            render={<Button type="button" variant="outline" disabled={disabled} />}
          >
            {limitsOpen ? '收起文件大小限制' : '调整文件大小限制'}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-5">
            <FieldSet>
              <FieldLegend>导入大小上限</FieldLegend>
              <FieldDescription>
                按原始上传字节计量，文本映射按提交的映射内容计量；ZIP 解压和图片校验始终开启
              </FieldDescription>
              {(
                [
                  {
                    name: 'maxImportFileKiB',
                    label: '文本和 JSON 上限（KiB）',
                    min: 64,
                    max: 4096,
                  },
                  { name: 'maxImportArchiveMiB', label: 'ZIP 包上限（MiB）', min: 1, max: 128 },
                ] as const
              ).map((item) => (
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
                  <FieldDescription>
                    {item.min}–{item.max}，收紧后不截断已保存的作品
                  </FieldDescription>
                  <FieldError errors={[form.formState.errors.data?.[item.name]]} />
                </Field>
              ))}
            </FieldSet>
          </CollapsibleContent>
        </Collapsible>
      </EditorSection>
    </>
  );
}
