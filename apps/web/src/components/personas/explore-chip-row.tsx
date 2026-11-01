'use client';
import { useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';

export function ExploreChipRow({
  label,
  options,
  values,
  multiple = false,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  values: string[];
  multiple?: boolean;
  onChange: (values: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = options.filter(
    (option, index) => expanded || index < 8 || values.includes(option.value),
  );
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start lg:gap-4">
      <legend className="sr-only">{label}</legend>
      <span aria-hidden className="shrink-0 font-medium lg:w-24 lg:pt-3">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
        <ToggleGroup
          aria-label={label + '选项'}
          multiple={multiple}
          variant="selection"
          className="max-w-full flex-wrap"
          value={values.length ? values : ['__all']}
          onValueChange={(next) => {
            if (next.includes('__all') && !values.includes('__all') && values.length) onChange([]);
            else onChange(next.filter((value) => value !== '__all'));
          }}
        >
          <ToggleGroupItem value="__all" className="min-h-11 min-w-16">
            全部
          </ToggleGroupItem>
          {visible.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className="h-auto min-h-11 max-w-full whitespace-normal break-all px-4 py-2 text-left"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {options.length > 8 && (
          <Button
            type="button"
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '收起' : '更多'}
            <ChevronDownIcon aria-hidden className={expanded ? 'rotate-180' : ''} />
          </Button>
        )}
      </div>
    </fieldset>
  );
}
