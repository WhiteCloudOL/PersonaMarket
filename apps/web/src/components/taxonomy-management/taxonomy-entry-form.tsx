'use client';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import {
  CreateTaxonomyEntrySchema,
  TaxonomyActionSchema,
  type CreateTaxonomyEntry,
  type ManagedTaxonomyEntry,
  type TaxonomyKind,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Input } from '@personamarket/ui/components/input';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
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
import { taxonomyManagementApi, type TaxonomyWrite } from '@/lib/taxonomy-management-api';

export function TaxonomyEntryForm({
  accountId,
  kind,
  initial,
  onDirty,
  onBusy,
  saved,
}: {
  accountId: string;
  kind: TaxonomyKind;
  initial: ManagedTaxonomyEntry | null;
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
  saved: (row: ManagedTaxonomyEntry) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [candidate, setCandidate] = useState<ManagedTaxonomyEntry>();
  const [readError, setReadError] = useState<Error>();
  const [reading, setReading] = useState(false);
  const [confirmation, setConfirmation] = useState<TaxonomyWrite>();
  const command = useRef<{ signature: string; key: string } | undefined>(undefined);
  const form = useForm<CreateTaxonomyEntry>({
    resolver: zodResolver(CreateTaxonomyEntrySchema),
    defaultValues: {
      name: initial?.name ?? '',
      active: initial?.active ?? true,
      sortOrder: initial?.sortOrder ?? 0,
      reason: '',
    },
  });
  const mutation = useMutation({
    mutationFn: (input: TaxonomyWrite) => {
      const signature = JSON.stringify(input);
      const prepared =
        command.current?.signature === signature
          ? command.current
          : { signature, key: crypto.randomUUID() };
      command.current = prepared;
      return taxonomyManagementApi.write(accountId, kind, input, prepared.key);
    },
    retry: false,
    onSuccess: async (response) => {
      onDirty(false);
      await saved(response.data);
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
  const archived = Boolean(snapshot?.archivedAt);
  const changedFields = Boolean(
    form.formState.dirtyFields.name ||
    form.formState.dirtyFields.active ||
    form.formState.dirtyFields.sortOrder,
  );
  async function readLatest() {
    if (!snapshot) return;
    setReading(true);
    setReadError(undefined);
    try {
      setCandidate(
        (
          await taxonomyManagementApi.detail(
            accountId,
            kind,
            snapshot.id,
            AbortSignal.timeout(10000),
          )
        ).data,
      );
    } catch (cause) {
      setReadError(cause instanceof Error ? cause : new Error('暂时无法读取目录状态'));
    } finally {
      setReading(false);
    }
  }
  function prepareAction() {
    if (!snapshot) return;
    const reason = TaxonomyActionSchema.safeParse({ reason: form.getValues('reason') });
    if (!reason.success) {
      form.setError('reason', { message: reason.error.issues[0]?.message ?? '请填写处理理由' });
      return;
    }
    form.clearErrors('reason');
    setConfirmation({
      action: archived ? 'restore' : 'archive',
      id: snapshot.id,
      revision: snapshot.revision,
      body: reason.data,
    });
  }
  return (
    <>
      <form
        noValidate
        onSubmit={form.handleSubmit((body) =>
          mutation.mutate(
            snapshot
              ? { action: 'update', id: snapshot.id, revision: snapshot.revision, body }
              : { action: 'create', body },
          ),
        )}
      >
        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.name)}>
            <FieldLabel htmlFor="taxonomy-name">名称</FieldLabel>
            <Input
              id="taxonomy-name"
              autoComplete="off"
              spellCheck={false}
              {...form.register('name')}
              disabled={mutation.isPending || archived}
              aria-invalid={Boolean(form.formState.errors.name)}
            />
            <FieldDescription>最多 80 字，名称不使用首尾空格</FieldDescription>
            <FieldError errors={[form.formState.errors.name]} />
          </Field>
          <Field data-invalid={Boolean(form.formState.errors.sortOrder)}>
            <FieldLabel htmlFor="taxonomy-sort">排序值</FieldLabel>
            <Input
              id="taxonomy-sort"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              {...form.register('sortOrder', { valueAsNumber: true })}
              disabled={mutation.isPending || archived}
              aria-invalid={Boolean(form.formState.errors.sortOrder)}
            />
            <FieldDescription>较小数值优先显示，可填 -10,000 到 10,000</FieldDescription>
            <FieldError errors={[form.formState.errors.sortOrder]} />
          </Field>
          <Controller
            name="active"
            control={form.control}
            render={({ field }) => (
              <Field orientation="horizontal">
                <FieldLabel
                  htmlFor="taxonomy-active"
                  className="min-h-11 w-full gap-3 rounded-lg border border-border p-3"
                >
                  <Checkbox
                    id="taxonomy-active"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={mutation.isPending || archived}
                  />
                  启用条目
                </FieldLabel>
              </Field>
            )}
          />
          <Field data-invalid={Boolean(form.formState.errors.reason)}>
            <FieldLabel htmlFor="taxonomy-reason">处理理由</FieldLabel>
            <Textarea
              id="taxonomy-reason"
              className="max-h-[40dvh] min-h-28 overflow-y-auto"
              autoComplete="off"
              {...form.register('reason')}
              disabled={mutation.isPending}
              aria-invalid={Boolean(form.formState.errors.reason)}
            />
            <FieldDescription>最多 2,000 字，每次操作分别保留记录</FieldDescription>
            <FieldError errors={[form.formState.errors.reason]} />
          </Field>
          <FormNotice error={mutation.error ?? readError} />
          <div className="flex flex-wrap gap-2">
            {!archived && (
              <Button type="submit" disabled={mutation.isPending || reading}>
                {mutation.isPending ? '正在处理…' : snapshot ? '保存调整' : '创建条目'}
              </Button>
            )}
            {snapshot && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void readLatest()}
                  disabled={mutation.isPending || reading}
                >
                  {reading ? '正在读取…' : '核对最新目录'}
                </Button>
                <Button
                  type="button"
                  variant={archived ? 'outline' : 'destructive'}
                  onClick={prepareAction}
                  disabled={mutation.isPending || reading || (!archived && changedFields)}
                >
                  {archived ? '恢复条目' : '归档条目'}
                </Button>
              </>
            )}
          </div>
          {snapshot && (
            <p className="text-xs text-muted-foreground">本次核对修订 {snapshot.revision}</p>
          )}
          {snapshot && !archived && changedFields && (
            <p className="text-sm text-muted-foreground">
              先保存或还原待修改的名称、排序和启用状态，再归档条目
            </p>
          )}
          {archived && (
            <p className="text-sm text-muted-foreground">
              恢复后先保持停用，再由管理员决定是否启用
            </p>
          )}
          {candidate && (
            <Alert role="status">
              <AlertTitle>最新目录状态</AlertTitle>
              <AlertDescription className="flex min-w-0 flex-col items-start gap-3">
                <p className="[overflow-wrap:anywhere]">
                  {candidate.name} · 修订 {candidate.revision} · 排序 {candidate.sortOrder} ·{' '}
                  {candidate.archivedAt ? '已归档' : candidate.active ? '已启用' : '已停用'}
                </p>
                <p>采用新修订后，请逐项核对保留的输入</p>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 max-w-full py-2 whitespace-normal"
                  onClick={() => {
                    setSnapshot(candidate);
                    setCandidate(undefined);
                    command.current = undefined;
                    mutation.reset();
                  }}
                >
                  采用最新修订继续核对
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
              {confirmation?.action === 'archive' ? '确认归档条目' : '确认恢复条目'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.action === 'archive'
                ? '有草稿或历史版本引用时不能归档，历史名称不会删除'
                : '恢复后保持停用，核对后再明确启用'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div
            tabIndex={0}
            role="region"
            aria-label="核对目录操作内容"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain rounded-md text-sm [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
          >
            <p>{snapshot?.name}</p>
            <p className="whitespace-pre-wrap">{confirmation?.body.reason}</p>
          </div>
          <AlertDialogFooter className="shrink-0">
            <AlertDialogCancel>返回核对</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmation?.action === 'archive' ? 'destructive' : 'default'}
              onClick={() => {
                if (!confirmation) return;
                const input = confirmation;
                setConfirmation(undefined);
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
