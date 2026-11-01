'use client';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { PersonaModerationSchema } from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@personamarket/ui/components/alert-dialog';
import { FormNotice } from '../auth/auth-fields';
import { adminPersonasApi, type AdminPersona } from '@/lib/admin-personas-api';

type Command = z.infer<typeof PersonaModerationSchema>;
const nextState = (item: AdminPersona) =>
  item.moderationState === 'blocked' ? 'normal' : 'blocked';

export function PersonaModerationForm({
  initial,
  accountId,
  changed,
  onDirty,
  onBusy,
  locked,
}: {
  initial: AdminPersona;
  accountId: string;
  changed: () => Promise<unknown>;
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
  locked: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [candidate, setCandidate] = useState<AdminPersona>();
  const [confirmation, setConfirmation] = useState<Command>();
  const [notice, setNotice] = useState<string>();
  const [readError, setReadError] = useState<Error>();
  const [reading, setReading] = useState(false);
  const command = useRef<{ signature: string; key: string } | undefined>(undefined);
  const form = useForm<Command>({
    resolver: zodResolver(PersonaModerationSchema),
    defaultValues: { state: nextState(initial), expectedRevision: initial.revision, reason: '' },
  });
  const mutation = useMutation({
    mutationFn: (input: Command) => {
      const signature = JSON.stringify(input);
      const prepared =
        command.current?.signature === signature
          ? command.current
          : { signature, key: crypto.randomUUID() };
      command.current = prepared;
      return adminPersonasApi.moderate(accountId, initial.id, input, prepared.key);
    },
    retry: false,
    onSuccess: async (result) => {
      try {
        const latest = (
          await adminPersonasApi.detail(accountId, initial.id, AbortSignal.timeout(10000))
        ).data;
        setSnapshot(latest);
        form.reset({ state: nextState(latest), expectedRevision: latest.revision, reason: '' });
        command.current = undefined;
        setReadError(undefined);
        setCandidate(undefined);
      } catch (cause) {
        setReadError(new Error('操作已处理，暂时无法读取最新状态，请核对后再操作', { cause }));
      }
      await changed();
      setNotice(result.data.message);
    },
  });
  const dirty = form.formState.isDirty;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    onBusy(mutation.isPending);
    return () => onBusy(false);
  }, [mutation.isPending, onBusy]);
  const restoring = snapshot.moderationState === 'blocked';
  async function readLatest() {
    setReading(true);
    setReadError(undefined);
    try {
      setCandidate(
        (await adminPersonasApi.detail(accountId, initial.id, AbortSignal.timeout(10000))).data,
      );
    } catch (cause) {
      setReadError(cause instanceof Error ? cause : new Error('暂时无法读取人设状态'));
    } finally {
      setReading(false);
    }
  }
  return (
    <>
      <form noValidate onSubmit={form.handleSubmit(setConfirmation)}>
        <FieldGroup>
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold">作品上下架</h3>
            <p className="text-sm text-muted-foreground">
              恢复仅解除管理员下架，作者隐藏、版本限制和账号状态仍然生效
            </p>
          </div>
          <Field data-invalid={Boolean(form.formState.errors.reason)}>
            <FieldLabel htmlFor="persona-moderation-reason">上下架理由</FieldLabel>
            <Textarea
              id="persona-moderation-reason"
              className="max-h-[40dvh] min-h-28 overflow-y-auto"
              autoComplete="off"
              {...form.register('reason')}
              aria-invalid={Boolean(form.formState.errors.reason)}
              disabled={locked || mutation.isPending}
            />
            <FieldDescription>理由会记入管理记录，最多 5,000 字</FieldDescription>
            <FieldError errors={[form.formState.errors.reason]} />
          </Field>
          <FormNotice error={mutation.error ?? readError} message={notice} />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant={restoring ? 'default' : 'destructive'}
              disabled={locked || mutation.isPending || reading}
            >
              {mutation.isPending ? '正在处理…' : restoring ? '准备恢复人设' : '准备下架人设'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void readLatest()}
              disabled={locked || mutation.isPending || reading}
            >
              {reading ? '正在读取…' : '核对上下架状态'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            本次核对修订 {snapshot.revision} · {restoring ? '已下架' : '未被管理员下架'}
          </p>
          {candidate && (
            <Alert role="status">
              <AlertTitle>最新上下架状态</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3">
                <p>
                  修订 {candidate.revision} ·{' '}
                  {candidate.moderationState === 'blocked' ? '已下架' : '未被管理员下架'}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked || mutation.isPending}
                  onClick={() => {
                    setSnapshot(candidate);
                    form.setValue('state', nextState(candidate));
                    form.setValue('expectedRevision', candidate.revision);
                    setCandidate(undefined);
                    command.current = undefined;
                    mutation.reset();
                    setNotice(undefined);
                  }}
                >
                  使用最新状态继续核对
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </FieldGroup>
      </form>
      <AlertDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open) setConfirmation(undefined);
        }}
      >
        <AlertDialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <AlertDialogHeader className="shrink-0">
            <AlertDialogTitle>
              {confirmation?.state === 'blocked' ? '确认下架这条人设' : '确认解除管理员下架'}
            </AlertDialogTitle>
            <AlertDialogDescription>请核对作品和理由，处理后会写入管理记录</AlertDialogDescription>
          </AlertDialogHeader>
          <div
            tabIndex={0}
            role="region"
            aria-label="核对作品和处理理由"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain rounded-md text-sm [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
          >
            <p>{snapshot.title || '未命名人设'}</p>
            <p className="whitespace-pre-wrap">{confirmation?.reason}</p>
          </div>
          <AlertDialogFooter className="shrink-0">
            <AlertDialogCancel>返回核对</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmation?.state === 'blocked' ? 'destructive' : 'default'}
              onClick={() => {
                if (!confirmation) return;
                const input = confirmation;
                setConfirmation(undefined);
                setNotice(undefined);
                mutation.mutate(input);
              }}
            >
              确认处理
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
