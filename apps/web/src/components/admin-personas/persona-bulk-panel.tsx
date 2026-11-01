'use client';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AdminPersonaBulkRequestSchema,
  SetPersonaCurationSchema,
  type AdminPersonaBulkRequest,
  type AdminPersonaBulkResponseSchema,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '@personamarket/ui/components/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@personamarket/ui/components/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { Separator } from '@personamarket/ui/components/separator';
import { FormNotice } from '../auth/auth-fields';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { adminPersonasApi, adminPersonasKey, type AdminPersona } from '@/lib/admin-personas-api';

const FormSchema = SetPersonaCurationSchema.pick({
  official: true,
  featured: true,
  reason: true,
  selfReviewConfirmed: true,
}).extend({ action: z.enum(['curate', 'block', 'restore']) });
type Values = z.infer<typeof FormSchema>;
type Result = z.infer<typeof AdminPersonaBulkResponseSchema>['data'][number];
const actions = [
  { value: 'curate', label: '设置推荐标记' },
  { value: 'block', label: '下架人设' },
  { value: 'restore', label: '解除管理员下架' },
];

export function PersonaBulkPanel({
  accountId,
  selected,
  open,
  close,
  finished,
}: {
  accountId: string;
  selected: AdminPersona[];
  open: boolean;
  close: () => void;
  finished: () => void;
}) {
  const client = useQueryClient();
  const [prepared, setPrepared] = useState<AdminPersonaBulkRequest>();
  const [results, setResults] = useState<Record<string, Result>>({});
  const [started, setStarted] = useState(false);
  const [candidate, setCandidate] = useState<AdminPersona>();
  const [readError, setReadError] = useState<Error>();
  const [reading, setReading] = useState<string>();
  const [targets, setTargets] = useState(selected);
  const form = useForm<z.input<typeof FormSchema>, unknown, Values>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      action: 'curate',
      official: false,
      featured: false,
      reason: '',
      selfReviewConfirmed: false,
    },
  });
  const action = useWatch({ control: form.control, name: 'action' });
  const mutation = useMutation({
    mutationFn: (input: AdminPersonaBulkRequest) => adminPersonasApi.bulk(accountId, input),
    retry: false,
    onSuccess: (response) =>
      setResults((previous) => ({
        ...previous,
        ...Object.fromEntries(response.data.map((item) => [item.id, item])),
      })),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: adminPersonasKey(accountId) });
    },
  });
  useUnsavedDraft(
    open && (form.formState.isDirty || Boolean(prepared)),
    '还有未完成的批量管理操作，确定离开吗',
  );
  function requestClose() {
    if (mutation.isPending || reading) return;
    if (
      (form.formState.isDirty || prepared) &&
      !window.confirm('关闭会放弃本批尚未完成的操作，确定关闭吗')
    )
      return;
    close();
  }
  const pending = prepared?.items.filter((item) => results[item.id]?.ok !== true) ?? [];
  async function readLatest(id: string) {
    setReading(id);
    setReadError(undefined);
    try {
      setCandidate((await adminPersonasApi.detail(accountId, id, AbortSignal.timeout(10000))).data);
    } catch (cause) {
      setReadError(cause instanceof Error ? cause : new Error('暂时无法读取最新状态'));
    } finally {
      setReading(undefined);
    }
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) requestClose();
      }}
    >
      <SheetContent
        className="sm:max-w-xl"
        showCloseButton={!mutation.isPending && !reading}
        finalFocus={() =>
          document.getElementById('select-persona-' + selected[0]?.id) ??
          document.getElementById('admin-personas-search')
        }
      >
        <SheetHeader>
          <SheetTitle>批量管理人设</SheetTitle>
          <SheetDescription>最多处理 20 条，按所选修订逐项校验和记录结果</SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-6 sm:px-5">
          {!prepared ? (
            <form
              noValidate
              onSubmit={form.handleSubmit((value) => {
                setTargets(selected);
                const base = {
                  reason: value.reason,
                  items: selected.map((item) => ({
                    id: item.id,
                    expectedRevision: item.revision,
                    idempotencyKey: crypto.randomUUID(),
                  })),
                };
                const body = AdminPersonaBulkRequestSchema.parse(
                  value.action === 'curate'
                    ? {
                        ...base,
                        action: 'curate',
                        official: value.official,
                        featured: value.featured,
                        selfReviewConfirmed: value.selfReviewConfirmed,
                      }
                    : { ...base, action: value.action },
                );
                setPrepared(body);
                setResults({});
                mutation.reset();
              })}
            >
              <FieldGroup>
                <Controller
                  name="action"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="persona-bulk-action">管理操作</FieldLabel>
                      <Select items={actions} value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="persona-bulk-action" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {actions.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                />
                {action === 'curate' && (
                  <>
                    <FieldDescription>
                      以下值会同时应用到所有所选作品，未勾选表示取消对应标记
                    </FieldDescription>
                    {(['official', 'featured'] as const).map((name) => (
                      <Controller
                        key={name}
                        name={name}
                        control={form.control}
                        render={({ field }) => (
                          <Field orientation="horizontal">
                            <FieldLabel
                              htmlFor={'bulk-' + name}
                              className="min-h-11 w-full gap-3 rounded-lg border border-border p-3"
                            >
                              <Checkbox
                                id={'bulk-' + name}
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                              {name === 'official' ? '官方作品' : '精选作品'}
                            </FieldLabel>
                          </Field>
                        )}
                      />
                    ))}
                    {selected.some((item) => item.owner.id === accountId) && (
                      <Controller
                        name="selfReviewConfirmed"
                        control={form.control}
                        render={({ field }) => (
                          <Field orientation="horizontal">
                            <FieldLabel
                              htmlFor="bulk-self"
                              className="min-h-11 w-full gap-3 rounded-lg border border-border p-3"
                            >
                              <Checkbox
                                id="bulk-self"
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                              我确认所选作品包含自己的作品
                            </FieldLabel>
                          </Field>
                        )}
                      />
                    )}
                  </>
                )}
                <Field data-invalid={Boolean(form.formState.errors.reason)}>
                  <FieldLabel htmlFor="persona-bulk-reason">批量处理理由</FieldLabel>
                  <Textarea
                    id="persona-bulk-reason"
                    autoComplete="off"
                    className="max-h-[40dvh] min-h-28 overflow-y-auto"
                    {...form.register('reason')}
                    aria-invalid={Boolean(form.formState.errors.reason)}
                  />
                  <FieldDescription>最多 2,000 字，每条作品分别记录</FieldDescription>
                  <FieldError errors={[form.formState.errors.reason]} />
                </Field>
                <Button type="submit" disabled={selected.length === 0}>
                  核对本批操作
                </Button>
              </FieldGroup>
            </form>
          ) : (
            <>
              <Alert role="status">
                <AlertTitle>{started ? '本批处理结果' : '请确认本批操作'}</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  <p>
                    {actions.find((item) => item.value === prepared.action)?.label} · 共{' '}
                    {prepared.items.length} 条
                  </p>
                  {prepared.action === 'curate' && (
                    <p>
                      官方{prepared.official ? '标记' : '取消'} · 精选
                      {prepared.featured ? '标记' : '取消'}
                    </p>
                  )}
                  <p
                    tabIndex={0}
                    role="region"
                    aria-label="本批处理理由"
                    className="max-h-32 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {prepared.reason}
                  </p>
                </AlertDescription>
              </Alert>
              <FormNotice error={mutation.error ?? readError} />
              <ul className="flex flex-col gap-3" aria-label="批量处理明细">
                {prepared.items.map((item) => {
                  const target = targets.find((value) => value.id === item.id);
                  const result = results[item.id];
                  return (
                    <li
                      key={item.id}
                      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-3"
                    >
                      <p className="font-medium [overflow-wrap:anywhere]">
                        {target?.title || '未命名人设'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        所选修订 {item.expectedRevision}
                      </p>
                      <p className="text-sm [overflow-wrap:anywhere]">
                        {result?.ok
                          ? '已处理 · ' + result.message
                          : result
                            ? '未处理 · ' + result.error.message
                            : mutation.isPending
                              ? '正在核对处理结果…'
                              : started
                                ? '尚未确认结果，可使用原操作标识重试'
                                : '等待确认'}
                      </p>
                      {started &&
                        result &&
                        !result.ok &&
                        result.error.code === 'REVISION_CONFLICT' && (
                          <Button
                            variant="outline"
                            disabled={mutation.isPending || Boolean(reading)}
                            onClick={() => void readLatest(item.id)}
                          >
                            核对这条作品的最新修订
                          </Button>
                        )}
                    </li>
                  );
                })}
              </ul>
              {candidate && (
                <Alert role="status">
                  <AlertTitle>请重新核对变更后的作品</AlertTitle>
                  <AlertDescription className="flex flex-col gap-3">
                    <p className="[overflow-wrap:anywhere]">
                      {candidate.title} · 最新修订 {candidate.revision} ·{' '}
                      {candidate.moderationState === 'blocked' ? '已下架' : '未被管理员下架'} · 官方
                      {candidate.curation.official ? '已标记' : '未标记'} · 精选
                      {candidate.curation.featured ? '已标记' : '未标记'}
                    </p>
                    <Button
                      variant="outline"
                      disabled={mutation.isPending}
                      onClick={() => {
                        setPrepared(
                          (body) =>
                            body && {
                              ...body,
                              items: body.items.map((item) =>
                                item.id === candidate.id
                                  ? {
                                      ...item,
                                      expectedRevision: candidate.revision,
                                      idempotencyKey: crypto.randomUUID(),
                                    }
                                  : item,
                              ),
                            },
                        );
                        setResults((previous) =>
                          Object.fromEntries(
                            Object.entries(previous).filter(([id]) => id !== candidate.id),
                          ),
                        );
                        setCandidate(undefined);
                        setStarted(false);
                        mutation.reset();
                      }}
                    >
                      采用这条作品的最新修订并重新确认
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                {pending.length > 0 && (
                  <Button
                    variant={prepared.action === 'block' ? 'destructive' : 'default'}
                    disabled={mutation.isPending || Boolean(reading) || Boolean(candidate)}
                    onClick={() => {
                      setStarted(true);
                      mutation.mutate({ ...prepared, items: pending });
                    }}
                  >
                    {mutation.isPending
                      ? '正在逐项处理…'
                      : started
                        ? '重试未完成项'
                        : '确认执行本批操作'}
                  </Button>
                )}
                {!started && !Object.keys(results).length && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPrepared(undefined);
                      setCandidate(undefined);
                    }}
                  >
                    返回修改
                  </Button>
                )}
                {started && (
                  <Button
                    variant="outline"
                    disabled={mutation.isPending || Boolean(reading)}
                    onClick={() => {
                      if (pending.length && !window.confirm('还有未完成项，确定结束本批操作吗'))
                        return;
                      finished();
                    }}
                  >
                    结束本批操作
                  </Button>
                )}
              </div>
              {started && (
                <p className="text-sm text-muted-foreground" role="status">
                  已确认成功 {prepared.items.length - pending.length} 条 · 待核对 {pending.length}{' '}
                  条
                </p>
              )}
            </>
          )}
          <Separator />
          {!prepared && (
            <ul aria-label="所选作品" className="flex flex-col gap-2">
              {selected.map((item) => (
                <li key={item.id} className="text-sm [overflow-wrap:anywhere]">
                  {item.title || '未命名人设'} · 修订 {item.revision}
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={requestClose}
            disabled={mutation.isPending || Boolean(reading)}
          >
            关闭批量面板
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
