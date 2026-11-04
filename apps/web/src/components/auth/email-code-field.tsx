import type { UseFormRegisterReturn } from 'react-hook-form';
import { Button } from '@personamarket/ui/components/button';
import { AuthField } from './auth-fields';

export function EmailCodeField({
  id,
  field,
  error,
  sending,
  sent,
  disabled,
  onSend,
}: {
  id: string;
  field: UseFormRegisterReturn;
  error?: string | undefined;
  sending: boolean;
  sent: boolean;
  disabled: boolean;
  onSend: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
      <AuthField
        id={id}
        label="邮箱验证码"
        autoComplete="one-time-code"
        inputMode="numeric"
        maxLength={6}
        disabled={disabled}
        readOnly={sending}
        spellCheck={false}
        error={error}
        {...field}
      />
      <Button
        type="button"
        variant="outline"
        className="shrink-0 sm:mt-7"
        disabled={disabled || sending}
        onClick={onSend}
      >
        {sending ? '正在申请…' : sent ? '重新发送验证码' : '发送验证码'}
      </Button>
    </div>
  );
}
