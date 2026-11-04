'use client';
import { useState, useRef, useEffect } from 'react';
import { useForm, useFormContext, useWatch } from 'react-hook-form';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  CreateReleaseSchema,
  PublicSnapshotSchema,
  publicSnapshotCandidate,
  canonicalJson,
  type PersonaDraft,
} from '@personamarket/contracts';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { Button } from '@personamarket/ui/components/button';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Field, FieldLabel, FieldError, FieldGroup } from '@personamarket/ui/components/field';
import { Textarea } from '@personamarket/ui/components/textarea';
import { AuthField, FormNotice, SubmitButton } from '../auth/auth-fields';
import { personasApi } from '@/lib/personas-api';
import { releasesApi } from '@/lib/releases-api';
import { ApiError } from '@/lib/auth-api';
import { SnapshotView, type Snapshot } from './snapshot-view';
import { PendingSubmissionHint } from './pending-submission-hint';
import { personaAvatarUploadKey } from './persona-avatar-field';
const formSchema = CreateReleaseSchema.pick({ version: true, changelog: true }).extend({
  confirmed: z.boolean().refine(Boolean, '请确认本次发版信息'),
});
export function ReleaseCreate({
  id,
  flush,
  initialAction = null,
}: {
  id: string;
  flush: () => Promise<number>;
  initialAction?: 'release' | null;
}) {
  const draft = useFormContext<PersonaDraft>();
  const client = useQueryClient();
  const avatarPending = useIsMutating({ mutationKey: personaAvatarUploadKey }) > 0;
  const opener = useRef<HTMLButtonElement>(null);
  const operation = useRef<{ body: string; key: string } | undefined>(undefined);
  const initialHandled = useRef(false);
  const [prepared, setPrepared] = useState<{ revision: number; snapshot: Snapshot }>();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { version: '', changelog: '', confirmed: false },
  });
  const confirmed = useWatch({ control: form.control, name: 'confirmed' });
  const prepare = useMutation({
    mutationFn: async () => {
      await flush();
      const saved = await personasApi.read(id);
      const checked = PublicSnapshotSchema.safeParse(publicSnapshotCandidate(saved.data.draft));
      if (!checked.success) throw new Error('请先补齐作品名称、简介、平台正文和来源许可');
      if (!saved.data.draft.rightsAccepted) throw new Error('请先勾选展示与复制下载授权');
      setPrepared({
        revision: saved.meta.revision,
        snapshot: checked.data,
      });
      operation.current = undefined;
      form.reset({ version: '', changelog: '', confirmed: false });
    },
    retry: false,
  });
  const submit = useMutation({
    mutationFn: async () => {
      if (!prepared) throw new Error('请重新准备发版快照');
      if (draft.formState.isDirty) await flush();
      const body = {
        ...form.getValues(),
        confirmed: true as const,
        expectedDraftRevision: prepared.revision,
      };
      const json = canonicalJson(body);
      if (operation.current?.body !== json)
        operation.current = { body: json, key: crypto.randomUUID() };
      return releasesApi.create(id, body, operation.current.key);
    },
    onSuccess: () => {
      setPrepared(undefined);
      void client.invalidateQueries({ queryKey: ['private', 'releases', id] });
    },
    retry: false,
  });
  const prepareRelease = prepare.mutate;
  useEffect(() => {
    if (initialAction !== 'release' || initialHandled.current) return;
    initialHandled.current = true;
    prepareRelease();
  }, [initialAction, prepareRelease]);
  return (
    <>
      <Button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={Boolean(prepared)}
        onClick={() => {
          submit.reset();
          prepare.mutate();
        }}
        disabled={prepare.isPending || avatarPending}
      >
        {prepare.isPending ? '正在准备快照…' : '创建 Release'}
      </Button>
      <FormNotice
        error={prepare.error}
        message={submit.isSuccess ? '版本已提交审核，草稿可以继续编辑' : undefined}
      />
      {submit.data?.data.status === 'PENDING' && (
        <PendingSubmissionHint personaId={id} submissionId={submit.data.data.id} />
      )}
      <Sheet
        open={Boolean(prepared)}
        onOpenChange={(open) => {
          if (!open && !submit.isPending) setPrepared(undefined);
        }}
      >
        <SheetContent
          className="w-full overflow-hidden sm:max-w-3xl"
          showCloseButton={!submit.isPending}
          // 异步准备时入口会禁用失焦，不能依赖弹窗打开前的活动元素
          finalFocus={opener}
        >
          <SheetHeader>
            <SheetTitle>确认本次发版</SheetTitle>
            <SheetDescription>本次内容会成为不可变审核快照，通过后再公开</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-5 pb-8">
            {prepared && (
              <>
                <h2 className="text-xl font-semibold break-words">{prepared.snapshot.title}</h2>
                <p className="text-sm text-muted-foreground">
                  草稿修订 {prepared.revision} ·{' '}
                  {prepared.snapshot.platform === 'maibot' ? 'MaiBot' : 'AstrBot'}
                </p>
                <SnapshotView snapshot={prepared.snapshot} imageBase="/api/v1/me/assets" />
              </>
            )}
            <form
              className="flex flex-col gap-5"
              noValidate
              onSubmit={(event) => {
                event.stopPropagation();
                void form.handleSubmit(() => submit.mutate())(event);
              }}
            >
              <FieldGroup>
                <AuthField
                  id="release-version"
                  label="版本号"
                  description="使用稳定语义版本，例如 1.0.0，必须高于历史最高已发布版本"
                  autoComplete="off"
                  {...form.register('version')}
                  error={form.formState.errors.version?.message}
                />
                <Field>
                  <FieldLabel htmlFor="release-changelog">更新日志</FieldLabel>
                  <Textarea
                    id="release-changelog"
                    {...form.register('changelog')}
                    aria-invalid={Boolean(form.formState.errors.changelog)}
                  />
                  <FieldError>{form.formState.errors.changelog?.message}</FieldError>
                </Field>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="release-confirm"
                    checked={confirmed}
                    onCheckedChange={(v) =>
                      form.setValue('confirmed', v === true, { shouldValidate: true })
                    }
                  />
                  <label htmlFor="release-confirm" className="text-sm leading-6">
                    我已核对公开内容、版本号及来源许可，确认提交审核
                  </label>
                </div>
                <FieldError>{form.formState.errors.confirmed?.message}</FieldError>
                <FormNotice error={submit.error} />
                {submit.error instanceof ApiError && submit.error.fieldErrors.length > 0 && (
                  <ul className="flex flex-col gap-2 text-sm text-destructive">
                    {submit.error.fieldErrors.map((error, i) => (
                      <li key={i}>
                        {error.path}：{error.message}
                      </li>
                    ))}
                  </ul>
                )}
                <SubmitButton pending={submit.isPending}>确认提交审核</SubmitButton>
              </FieldGroup>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
