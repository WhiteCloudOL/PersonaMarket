'use client';
import { useState, useId } from 'react';
import type { UseFormReturn, FieldPath } from 'react-hook-form';
import type { RankingSettingsWrite } from '@personamarket/contracts';
import { Input } from '@personamarket/ui/components/input';
import { Button } from '@personamarket/ui/components/button';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { EditorSection } from '../personas/editor-section';

type Name = Exclude<FieldPath<RankingSettingsWrite>, 'data' | 'data.weights' | 'reason'>;
export function RankingSettingsInputs({
  form,
  disabled,
}: {
  form: UseFormReturn<RankingSettingsWrite>;
  disabled: boolean;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const advancedError = Boolean(
    form.formState.errors.data?.refreshMinutes ||
    form.formState.errors.data?.entryLimit ||
    form.formState.errors.data?.newcomerWindowDays,
  );
  const open = expanded || advancedError;
  function number(
    name: Name,
    label: string,
    min: number,
    max: number,
    description: string,
    step = 1,
  ) {
    const error = form.getFieldState(name, form.formState).error;
    return (
      <Field key={name} data-invalid={Boolean(error)}>
        <FieldLabel htmlFor={id + name}>{label}</FieldLabel>
        <Input
          id={id + name}
          type="number"
          min={min}
          max={max}
          step={step}
          inputMode={step === 1 ? 'numeric' : 'decimal'}
          autoComplete="off"
          {...form.register(name, { valueAsNumber: true })}
          disabled={disabled}
          aria-invalid={Boolean(error)}
        />
        <FieldDescription>{description}</FieldDescription>
        <FieldError errors={[error]} />
      </Field>
    );
  }
  return (
    <>
      <EditorSection
        title="热门评分"
        description="只影响新排队批次，近 7 天有效事实按 7 天半衰期衰减，探索页继续使用固定 interactions-v1 口径"
      >
        <div className="grid min-w-0 gap-5 md:grid-cols-3">
          {number(
            'data.weights.likes',
            '点赞权重',
            0,
            100,
            '0–100，可填小数，作者本人不计分',
            0.01,
          )}
          {number(
            'data.weights.favorites',
            '收藏权重',
            0,
            100,
            '0–100，可填小数，收藏者身份保持私有',
            0.01,
          )}
          {number(
            'data.weights.exports',
            '导出权重',
            0,
            100,
            '0–100，可填小数，使用去重有效导出',
            0.01,
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          三个权重均为 0 时，热门榜为空；点赞榜、收藏榜和下载榜继续按各自有效数量排序
        </p>
      </EditorSection>
      <EditorSection
        title="刷新和展示"
        description="保存配置不等于计算已完成，查看实际批次状态确认公开结果"
      >
        <Collapsible open={open} onOpenChange={setExpanded}>
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                className="h-auto min-h-11 max-w-full whitespace-normal"
              />
            }
          >
            {open ? '收起刷新和展示设置' : '调整刷新和展示设置'}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-5">
            <div className="grid min-w-0 gap-5 md:grid-cols-2">
              {number(
                'data.refreshMinutes',
                '刷新周期（分钟）',
                1,
                60,
                '1–60 分钟，Worker 按数据库时间安排周期请求，执行可能延迟',
              )}
              {number(
                'data.entryLimit',
                '每榜展示上限',
                1,
                1000,
                '1–1000 项，读取时仍会过滤下架或不可用作品',
              )}
              {number(
                'data.newcomerWindowDays',
                '运营新作窗口（天）',
                1,
                365,
                '1–365 天，以首次公开时间计算；显式“近 30 天”分享地址继续保留原范围',
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </EditorSection>
    </>
  );
}
