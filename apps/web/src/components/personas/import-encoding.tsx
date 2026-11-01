'use client';
import {
  ImportTextEncodingSchema,
  type ImportTextEncoding,
  type ImportSourceEncoding,
} from '@personamarket/contracts';
import { Field, FieldLabel, FieldDescription } from '@personamarket/ui/components/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@personamarket/ui/components/select';

const encodings = [
  { value: 'auto', label: '自动识别（推荐）' },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gbk', label: 'GBK' },
  { value: 'gb18030', label: 'GB18030' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
] satisfies { value: ImportTextEncoding; label: string }[];

export function ImportEncodingField({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  value: ImportTextEncoding;
  onChange: (value: ImportTextEncoding) => void;
  disabled?: boolean;
}) {
  return (
    <Field data-disabled={disabled || undefined}>
      <FieldLabel id={id + '-label'}>文件编码</FieldLabel>
      <Select
        value={value}
        items={encodings}
        disabled={disabled}
        onValueChange={(next) => {
          const parsed = ImportTextEncodingSchema.safeParse(next);
          if (parsed.success) onChange(parsed.data);
        }}
      >
        <SelectTrigger
          aria-labelledby={id + '-label'}
          aria-describedby={id + '-help'}
          className="w-full whitespace-normal"
        >
          <SelectValue className="min-w-0" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {encodings.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription id={id + '-help'}>
        支持 UTF-8、GBK/GB18030 和 UTF-16，预览乱码时可切换编码重试；ZIP 包无需选择编码
      </FieldDescription>
    </Field>
  );
}

export function ImportEncodingSummary({ value }: { value: ImportSourceEncoding | undefined }) {
  if (!value) return null;
  const label = encodings.find((item) => item.value === value.encoding)?.label ?? value.encoding;
  const method = {
    bom: 'BOM 识别',
    utf8: 'UTF-8 校验',
    fallback: '自动回退，请核对正文',
    manual: '手动选择',
  }[value.determinedBy];
  return (
    <p role="status" className="text-sm leading-6 text-muted-foreground">
      文件编码：{label} · {method}
    </p>
  );
}
