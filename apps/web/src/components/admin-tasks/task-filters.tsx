'use client';
import { useState } from 'react';
import type { AdminTaskQuery } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Field, FieldGroup, FieldLabel } from '@personamarket/ui/components/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@personamarket/ui/components/select';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@personamarket/ui/components/sheet';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import { taskCategories, taskStages } from './task-fields';

export function TaskFilters({
  initial,
  apply,
}: {
  initial: AdminTaskQuery;
  apply: (value: Pick<AdminTaskQuery, 'category' | 'stage'>) => void;
}) {
  const [open, setOpen] = useState(false),
    [stage, setStage] = useState(initial.stage);
  return (
    <FieldGroup className="flex flex-wrap items-end gap-3 sm:flex-row">
      <Field className="min-w-0 sm:max-w-64">
        <FieldLabel htmlFor="task-category">任务类别</FieldLabel>
        <Select
          items={taskCategories}
          value={initial.category}
          onValueChange={(value) => {
            const selected = taskCategories.find((item) => item.value === value);
            if (selected) apply({ category: selected.value, stage: initial.stage });
          }}
        >
          <SelectTrigger id="task-category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {taskCategories.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Sheet
        open={open}
        onOpenChange={(value) => {
          if (value) setStage(initial.stage);
          setOpen(value);
        }}
      >
        <SheetTrigger render={<Button variant="outline" />}>
          {initial.stage === 'all' ? '按阶段筛选' : '阶段筛选 · 1'}
        </SheetTrigger>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>按阶段筛选</SheetTitle>
            <SheetDescription>先选择阶段，应用后更新列表，关闭此面板会保留原筛选</SheetDescription>
          </SheetHeader>
          <div className="px-4">
            <FieldGroup>
              <Field>
                <FieldLabel id="task-stage-label">失败阶段</FieldLabel>
                <ToggleGroup
                  aria-labelledby="task-stage-label"
                  value={[stage]}
                  onValueChange={(values) => {
                    const selected = taskStages.find((item) => item.value === values[0]);
                    if (selected) setStage(selected.value);
                  }}
                  variant="outline"
                  className="flex-col items-stretch"
                  orientation="vertical"
                >
                  {taskStages.map((item) => (
                    <ToggleGroupItem
                      className="min-h-11 justify-start whitespace-normal"
                      key={item.value}
                      value={item.value}
                    >
                      {item.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
            </FieldGroup>
          </div>
          <SheetFooter className="mt-auto">
            <Button
              onClick={() => {
                apply({ category: initial.category, stage });
                setOpen(false);
              }}
            >
              应用筛选
            </Button>
            <Button variant="outline" onClick={() => setStage('all')}>
              重置阶段
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      {initial.stage !== 'all' && (
        <Button variant="ghost" onClick={() => apply({ category: initial.category, stage: 'all' })}>
          清除阶段筛选
        </Button>
      )}
    </FieldGroup>
  );
}
