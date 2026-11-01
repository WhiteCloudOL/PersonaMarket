'use client';
import type { Platform } from '@personamarket/contracts';
import { BotIcon, SparklesIcon, CheckCircle2Icon } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import { Field, FieldLabel, FieldDescription } from '@personamarket/ui/components/field';
import { EditorSection } from './editor-section';
export function PlatformField({
  value,
  onChange,
}: {
  value: Platform;
  onChange: (value: Platform) => void;
}) {
  return (
    <EditorSection
      id="platform-selection"
      step="02"
      title="平台选择"
      description="保存后平台保持固定，两种平台的正文分别编辑"
    >
      <Field>
        <FieldLabel id="platform-label">目标平台</FieldLabel>
        <ToggleGroup
          value={[value]}
          aria-labelledby="platform-label"
          variant="outline"
          className="grid w-full grid-cols-1 items-stretch gap-3 @min-[24rem]/creation:grid-cols-2"
          onValueChange={(selected) => {
            if (selected[0] === 'maibot' || selected[0] === 'astrbot') onChange(selected[0]);
          }}
        >
          {(
            [
              {
                id: 'maibot',
                name: 'MaiBot',
                icon: BotIcon,
                tone: 'bg-maibot-soft text-maibot',
                text: '人格、表达与行为',
              },
              {
                id: 'astrbot',
                name: 'AstrBot',
                icon: SparklesIcon,
                tone: 'bg-astrbot-soft text-astrbot',
                text: '人格与成对预设对话',
              },
            ] as const
          ).map(({ id, name, icon: Icon, tone, text }) => (
            <ToggleGroupItem
              key={id}
              value={id}
              aria-label={name}
              className="relative h-auto min-h-32 w-full min-w-0 items-start justify-start rounded-xl p-4 text-left whitespace-normal data-pressed:border-primary data-pressed:bg-accent/50"
            >
              <span className="flex min-w-0 flex-col gap-2">
                <span className={'flex size-9 items-center justify-center rounded-lg ' + tone}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="text-lg font-semibold">{name}</span>
                <span className="text-sm leading-6 text-muted-foreground">{text}</span>
              </span>
              {value === id && (
                <CheckCircle2Icon
                  className="absolute top-4 right-4 size-4 text-primary"
                  aria-hidden
                />
              )}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldDescription>切换时保留本页各平台的输入，保存时只提交当前选择的平台</FieldDescription>
      </Field>
    </EditorSection>
  );
}
