'use client';
import type { ComponentProps } from 'react';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { Input } from '@personamarket/ui/components/input';
import { Alert, AlertDescription, AlertTitle } from '@personamarket/ui/components/alert';
import { Button } from '@personamarket/ui/components/button';
import { Spinner } from '@personamarket/ui/components/spinner';
import { needsOperationVerification, StepUpPrompt } from './step-up-prompt';
import { ApiError } from '@/lib/auth-api';
import { MaintenanceWriteNotice } from '../system/maintenance-write-notice';

export function AuthField({
  label,
  error,
  description,
  id,
  ...props
}: ComponentProps<typeof Input> & {
  id: string;
  label: string;
  error?: string | undefined;
  description?: string;
}) {
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        spellCheck={false}
        {...props}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={
          [description ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') ||
          undefined
        }
      />
      {description && <FieldDescription id={`${id}-help`}>{description}</FieldDescription>}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  );
}
export function FormNotice({
  error,
  message,
}: {
  error?: string | Error | null | undefined;
  message?: string | undefined;
}) {
  if (!error && !message) return null;
  if (error instanceof ApiError && error.code === 'MAINTENANCE_MODE')
    return <MaintenanceWriteNotice message={error.message} />;
  if (needsOperationVerification(error)) return <StepUpPrompt error={error} />;
  return (
    <div className="flex flex-col gap-3">
      <Alert variant={error ? 'destructive' : 'default'} aria-live="polite">
        <AlertTitle>{error ? '请再试一次' : '操作提示'}</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : (error ?? message)}
        </AlertDescription>
      </Alert>
    </div>
  );
}
export function SubmitButton({
  pending,
  children,
  variant = 'default',
  disabled = false,
  className,
}: {
  pending: boolean;
  children: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>['variant'];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button type="submit" disabled={pending || disabled} variant={variant} className={className}>
      {pending && <Spinner data-icon="inline-start" className="motion-reduce:animate-none" />}
      {pending ? '正在处理…' : children}
    </Button>
  );
}
