'use client';
import { Controller, useFieldArray, type UseFormReturn } from 'react-hook-form';
import type { HomeSettingsWrite, OptionalNavigationKey } from '@personamarket/contracts';
import { ArrowUpIcon, ArrowDownIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Switch } from '@personamarket/ui/components/switch';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldSet,
  FieldLegend,
} from '@personamarket/ui/components/field';
import { EditorSection } from '../personas/editor-section';
import { homeSectionLabels, optionalNavigationLabels } from './home-settings-summary';

const navigationKeys: OptionalNavigationKey[] = ['rankings', 'publish', 'guides', 'announcements'];
const sectionDescriptions = {
  featured: '展示管理员选定且可以公开访问的作品，没有精选时收起',
  recent: '展示最近公开的作品，没有作品时提供创作引导',
  announcements: '展示已发布的公告，没有公开公告时收起',
  creation: '展示平台入口、创作步骤和创作者入口',
};
export function HomeSettingsInputs({
  form,
  disabled,
}: {
  form: UseFormReturn<HomeSettingsWrite>;
  disabled: boolean;
}) {
  const sections = useFieldArray({ control: form.control, name: 'data.sections' });
  return (
    <>
      <EditorSection
        title="首屏文字"
        description="站名和简介沿用站点品牌设置，这里调整首页的简短提示"
      >
        <Field data-invalid={Boolean(form.formState.errors.data?.heroNote)}>
          <FieldLabel htmlFor="home-note">首页短提示</FieldLabel>
          <Input
            id="home-note"
            autoComplete="off"
            spellCheck={false}
            {...form.register('data.heroNote')}
            disabled={disabled}
            aria-invalid={Boolean(form.formState.errors.data?.heroNote)}
          />
          <FieldDescription>最多 200 个 Unicode 字符，使用单行文字</FieldDescription>
          <FieldError errors={[form.formState.errors.data?.heroNote]} />
        </Field>
      </EditorSection>
      <EditorSection
        title="首页模块"
        description="通过上移、下移调整阅读顺序，收起模块会保留作品和公告的原有访问规则"
      >
        {sections.fields.map((row, index) => (
          <FieldSet key={row.id} className="min-w-0 rounded-xl border border-border p-3">
            <FieldLegend variant="label">{homeSectionLabels[row.key]}</FieldLegend>
            <Controller
              control={form.control}
              name={`data.sections.${index}.enabled`}
              render={({ field }) => (
                <Field orientation="horizontal">
                  <FieldLabel
                    htmlFor={'home-section-' + row.key}
                    className="min-h-11 w-full justify-between gap-3"
                  >
                    展示{homeSectionLabels[row.key]}
                    <Switch
                      id={'home-section-' + row.key}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={disabled}
                    />
                  </FieldLabel>
                </Field>
              )}
            />
            <FieldDescription>{sectionDescriptions[row.key]}</FieldDescription>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                aria-label={homeSectionLabels[row.key] + '上移'}
                disabled={disabled || index === 0}
                onClick={() => sections.move(index, index - 1)}
              >
                <ArrowUpIcon aria-hidden />
                上移
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-label={homeSectionLabels[row.key] + '下移'}
                disabled={disabled || index === sections.fields.length - 1}
                onClick={() => sections.move(index, index + 1)}
              >
                <ArrowDownIcon aria-hidden />
                下移
              </Button>
            </div>
          </FieldSet>
        ))}
        <FieldError errors={[form.formState.errors.data?.sections]} />
      </EditorSection>
      <EditorSection
        title="展示数量"
        description="数量是模块的展示上限，页面只使用符合公开条件的真实内容"
      >
        {(
          [
            { name: 'featuredCount', label: '精选展示数量', max: 12 },
            { name: 'recentCount', label: '新作展示数量', max: 12 },
            { name: 'announcementCount', label: '公告展示数量', max: 5 },
          ] as const
        ).map((row) => (
          <Field key={row.name} data-invalid={Boolean(form.formState.errors.data?.[row.name])}>
            <FieldLabel htmlFor={'home-' + row.name}>{row.label}</FieldLabel>
            <Input
              id={'home-' + row.name}
              type="number"
              inputMode="numeric"
              min={1}
              max={row.max}
              step={1}
              autoComplete="off"
              {...form.register(`data.${row.name}`, { valueAsNumber: true })}
              disabled={disabled}
              aria-invalid={Boolean(form.formState.errors.data?.[row.name])}
            />
            <FieldDescription>可设置 1–{row.max} 条</FieldDescription>
            <FieldError errors={[form.formState.errors.data?.[row.name]]} />
          </Field>
        ))}
      </EditorSection>
      <EditorSection
        title="主导航"
        description="首页和探索始终保留，可选择其余入口并调整顺序，隐藏入口不会关闭对应功能"
      >
        <Controller
          control={form.control}
          name="data.navigation"
          render={({ field }) => (
            <>
              <FieldSet>
                <FieldLegend variant="label">选择可展示入口</FieldLegend>
                {navigationKeys.map((key) => (
                  <Field key={key} orientation="horizontal">
                    <FieldLabel
                      htmlFor={'home-navigation-' + key}
                      className="min-h-11 w-full gap-3 rounded-lg border border-border p-3"
                    >
                      <Checkbox
                        id={'home-navigation-' + key}
                        checked={field.value.includes(key)}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked
                              ? [...field.value, key]
                              : field.value.filter((value) => value !== key),
                          )
                        }
                        disabled={disabled}
                      />
                      {optionalNavigationLabels[key]}
                    </FieldLabel>
                  </Field>
                ))}
              </FieldSet>
              <ol aria-label="可选导航顺序" className="flex min-w-0 flex-col gap-3">
                {field.value.map((key, index) => (
                  <li
                    key={key}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                  >
                    <span className="text-sm">
                      {index + 1} · {optionalNavigationLabels[key]}
                    </span>
                    <div className="flex gap-2">
                      {([-1, 1] as const).map((direction) => (
                        <Button
                          key={direction}
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={
                            optionalNavigationLabels[key] +
                            (direction < 0 ? '导航上移' : '导航下移')
                          }
                          disabled={
                            disabled ||
                            index + direction < 0 ||
                            index + direction >= field.value.length
                          }
                          onClick={() => {
                            const values = [...field.value];
                            const [moved] = values.splice(index, 1);
                            if (!moved) return;
                            values.splice(index + direction, 0, moved);
                            field.onChange(values);
                          }}
                        >
                          {direction < 0 ? (
                            <ArrowUpIcon aria-hidden />
                          ) : (
                            <ArrowDownIcon aria-hidden />
                          )}
                        </Button>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
              <FieldError errors={[form.formState.errors.data?.navigation]} />
            </>
          )}
        />
      </EditorSection>
    </>
  );
}
