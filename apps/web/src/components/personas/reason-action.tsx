'use client';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { textSchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Field, FieldLabel, FieldError, FieldGroup } from '@personamarket/ui/components/field';
import { FormNotice, SubmitButton } from '../auth/auth-fields';
const schema = z.strictObject({ reason: textSchema(1, 5000) });
/** 状态变更先展示影响。需要说明审核决定时才显示理由输入。 */
export function ReasonAction({
  label,
  description,
  action,
  onSuccess,
  destructive = false,
  auditDescription,
}: {
  label: string;
  description: string;
  action: (reason: string) => Promise<unknown>;
  onSuccess: () => void;
  destructive?: boolean;
  auditDescription?: string;
}) {
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { reason: auditDescription ?? '' },
  });
  const mutation = useMutation({
    mutationFn: () => action(form.getValues('reason')),
    onSuccess: () => {
      setOpen(false);
      onSuccess();
    },
    retry: false,
  });
  return (
    <>
      <Button
        type="button"
        variant={destructive ? 'destructive' : 'outline'}
        onClick={() => {
          mutation.reset();
          form.reset();
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Sheet
        open={open}
        onOpenChange={(v) => {
          if (!mutation.isPending) setOpen(v);
        }}
      >
        <SheetContent showCloseButton={!mutation.isPending} className="overflow-hidden">
          <SheetHeader>
            <SheetTitle>{label}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <form
            className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-5"
            onSubmit={form.handleSubmit(() => mutation.mutate())}
            noValidate
          >
            <FieldGroup>
              {auditDescription === undefined && (
                <Field>
                  <FieldLabel htmlFor={reasonId}>操作理由</FieldLabel>
                  <Textarea
                    id={reasonId}
                    {...form.register('reason')}
                    aria-invalid={Boolean(form.formState.errors.reason)}
                  />
                  <FieldError>{form.formState.errors.reason?.message}</FieldError>
                </Field>
              )}
              <FormNotice error={mutation.error} />
              <SubmitButton
                pending={mutation.isPending}
                variant={destructive ? 'destructive' : 'default'}
              >
                确认{label}
              </SubmitButton>
            </FieldGroup>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
