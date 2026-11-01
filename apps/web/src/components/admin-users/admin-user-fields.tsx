'use client';
import { Field, FieldLabel } from '@personamarket/ui/components/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@personamarket/ui/components/select';

export const userRoles = [
  { value: 'user', label: '创作者' },
  { value: 'moderator', label: '审核员' },
  { value: 'admin', label: '管理员' },
] as const;
export const userStatuses = [
  { value: 'active', label: '正常' },
  { value: 'banned', label: '已封禁' },
  { value: 'deactivated', label: '已停用' },
] as const;
export const roleLabel = (value: string) =>
  userRoles.find((item) => item.value === value)?.label ?? value;
export const statusLabel = (value: string) =>
  userStatuses.find((item) => item.value === value)?.label ?? value;

export function AdminUserChoice({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={[...options]}
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
