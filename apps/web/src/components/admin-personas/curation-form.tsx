'use client';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { SetPersonaCurationSchema, type SetPersonaCuration } from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '@personamarket/ui/components/field';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Spinner } from '@personamarket/ui/components/spinner';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { FormNotice } from '../auth/auth-fields';
import { adminPersonasApi, type AdminPersona } from '@/lib/admin-personas-api';
export function CurationForm({
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
  const [notice, setNotice] = useState<string>();
  const [refreshError, setRefreshError] = useState<Error>();
  const [reading, setReading] = useState(false);
  const command = useRef<{ signature: string; key: string } | undefined>(undefined);
  const form = useForm<z.input<typeof SetPersonaCurationSchema>, unknown, SetPersonaCuration>({
    resolver: zodResolver(SetPersonaCurationSchema),
    defaultValues: {
      ...initial.curation,
      expectedRevision: initial.revision,
      reason: '',
      selfReviewConfirmed: false,
    },
  });
  const mutation = useMutation({
    mutationFn: (input: SetPersonaCuration) => {
      const signature = JSON.stringify(input);
      const prepared =
        command.current && command.current.signature === signature
          ? command.current
          : { signature, key: crypto.randomUUID() };
      command.current = prepared;
      return adminPersonasApi.curate(accountId, initial.id, input, prepared.key);
    },
    retry: false,
    onSuccess: async (result) => {
      try {
        const latest = (
          await adminPersonasApi.detail(accountId, initial.id, AbortSignal.timeout(10000))
        ).data;
        setSnapshot(latest);
        form.reset({
          ...latest.curation,
          expectedRevision: latest.revision,
          reason: '',
          selfReviewConfirmed: false,
        });
        command.current = undefined;
        setCandidate(undefined);
        setRefreshError(undefined);
      } catch (cause) {
        setRefreshError(new Error('操作已处理，暂时无法读取最新状态，请核对后再操作', { cause }));
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
  async function reviewLatest() {
    setReading(true);
    setRefreshError(undefined);
    try {
      setCandidate(
        (await adminPersonasApi.detail(accountId, initial.id, AbortSignal.timeout(10000))).data,
      );
    } catch (cause) {
      setRefreshError(cause instanceof Error ? cause : new Error('暂时无法读取人设状态'));
    } finally {
      setReading(false);
    }
  }
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((input) => {
        setNotice(undefined);
        mutation.mutate(input);
      })}
    >
      <FieldGroup>
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold">推荐标记</h3>
          <p className="text-sm text-muted-foreground">
            新标记只用于当前公开作品，解除标记不修改作者正文
          </p>
        </div>
        {(['official', 'featured'] as const).map((name) => (
          <Controller
            key={name}
            name={name}
            control={form.control}
            render={({ field }) => (
              <Field orientation="horizontal" data-disabled={mutation.isPending}>
                <FieldLabel
                  className="min-h-11 w-full gap-3 rounded-lg border border-border px-3 py-2"
                  htmlFor={'curation-' + name}
                >
                  <Checkbox
                    id={'curation-' + name}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={mutation.isPending || locked}
                  />
                  {name === 'official' ? '官方作品' : '精选作品'}
                </FieldLabel>
              </Field>
            )}
          />
        ))}
        <Field data-invalid={Boolean(form.formState.errors.reason)}>
          <FieldLabel htmlFor="curation-reason">处理理由</FieldLabel>
          <Textarea
            id="curation-reason"
            className="max-h-[40dvh] min-h-28 overflow-y-auto"
            autoComplete="off"
            placeholder="说明设置或取消标记的依据…"
            {...form.register('reason')}
            aria-invalid={Boolean(form.formState.errors.reason)}
            disabled={mutation.isPending || locked}
          />
          <FieldDescription>理由会记入管理记录，最多 2,000 字</FieldDescription>
          <FieldError errors={[form.formState.errors.reason]} />
        </Field>
        {initial.owner.id === accountId && (
          <Controller
            name="selfReviewConfirmed"
            control={form.control}
            render={({ field }) => (
              <Field orientation="horizontal">
                <FieldLabel
                  htmlFor="curation-self"
                  className="min-h-11 w-full gap-3 rounded-lg border border-border p-3"
                >
                  <Checkbox
                    id="curation-self"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={mutation.isPending || locked}
                  />
                  我确认正在管理自己的作品
                </FieldLabel>
              </Field>
            )}
          />
        )}
        <FormNotice error={mutation.error ?? refreshError} message={notice} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={mutation.isPending || reading || locked}>
            {mutation.isPending && <Spinner data-icon="inline-start" aria-label="正在保存标记" />}
            保存标记
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void reviewLatest()}
            disabled={mutation.isPending || reading || locked}
          >
            {reading ? '正在读取…' : '核对最新状态'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">本次核对修订 {snapshot.revision}</p>
        {candidate && (
          <Alert role="status">
            <AlertTitle>最新状态</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              <p className="text-sm">
                最新修订 {candidate.revision} · {candidate.publiclyVisible ? '公开展示' : '未公开'}{' '}
                · 官方{candidate.curation.official ? '已标记' : '未标记'} · 精选
                {candidate.curation.featured ? '已标记' : '未标记'}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending || locked}
                onClick={() => {
                  setSnapshot(candidate);
                  form.setValue('expectedRevision', candidate.revision, { shouldDirty: true });
                  setCandidate(undefined);
                  command.current = undefined;
                  mutation.reset();
                  setNotice(undefined);
                }}
              >
                使用最新修订继续核对
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </FieldGroup>
    </form>
  );
}
