'use client';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { AdminUserDetailSchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { Checkbox } from '@personamarket/ui/components/checkbox';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '@personamarket/ui/components/field';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { cn } from '@personamarket/ui/lib/utils';
import { adminUsersApi, adminUsersKey } from '@/lib/admin-users-api';
import { FormNotice, SubmitButton } from '../auth/auth-fields';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { AdminUserChoice, roleLabel, statusLabel, userRoles } from './admin-user-fields';
import { ActionSchema, FormSchema } from './admin-user-form-schema';
import { useAdminUserDrafts } from './admin-user-drafts';
import { AdminDeactivationHistory } from './admin-deactivation-history';
import { AdminUserContentTabs } from './admin-user-content-tabs';
import { AdminDeleteDialog } from '../admin/admin-delete-dialog';

type Snapshot = z.infer<typeof AdminUserDetailSchema>;
const actionLabels = {
  role: '调整角色',
  ban: '封禁账号',
  restore: '恢复账号',
  sessions: '撤销会话',
  deactivation: '处理停用申请',
} as const;
const recordLabels = {
  set_role: '调整角色',
  ban: '封禁账号',
  restore: '恢复账号',
  revoke_sessions: '撤销全部会话',
} as const;
const actionHelp = {
  role: '新角色立即生效，目标账号的全部旧会话会被撤销',
  ban: '默认仅封禁账号，公开作品继续按作品状态展示；同时下架需要明确选择',
  restore: '恢复账号可重新登录，已下架作品需在作品管理中单独核对',
  sessions: '撤销目标账号的全部会话，之后需要重新登录',
  deactivation: '批准后停用账号并退出所有设备，作品保持当前状态；驳回不改变账号与会话',
} as const;

function UserDetailForm({
  initial,
  accountId,
  open,
  close,
  reload,
  changed,
  onDirty,
}: {
  initial: Snapshot;
  accountId: string;
  open: boolean;
  close: () => void;
  reload: () => Promise<Snapshot | undefined>;
  changed: (value: Snapshot) => Promise<void>;
  onDirty: (value: boolean) => void;
}) {
  // 同一用户的表单状态独立于Query重连结果，只有明确读取新状态才替换操作依据。
  const drafts = useAdminUserDrafts();
  const [saved] = useState(() => drafts.read(accountId, initial.id));
  const [restored, setRestored] = useState(Boolean(saved));
  const [snapshot, setSnapshot] = useState(saved?.snapshot ?? initial);
  const [notice, setNotice] = useState<string>();
  const [reading, setReading] = useState(false);
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: saved?.values ?? {
      action: 'role',
      role: initial.role,
      scope: 'account_only',
      applicationId:
        initial.deactivationRequests.find((request) => request.status === 'pending')?.id ?? '',
      decision: 'approve',
      reason: '',
      confirmed: false,
    },
  });
  const action = useWatch({ control: form.control, name: 'action' });
  const desiredRole = useWatch({ control: form.control, name: 'role' });
  const applicationId = useWatch({ control: form.control, name: 'applicationId' });
  const pending = snapshot.deactivationRequests.filter((request) => request.status === 'pending');
  const selectedApplication = snapshot.deactivationRequests.find(
    (request) => request.id === applicationId,
  );
  const values = useWatch({ control: form.control });
  const request = useRef<{ signature: string; key: string } | null>(saved?.request ?? null);
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof FormSchema>) => {
      const base = { expectedSecurityVersion: snapshot.securityVersion, reason: values.reason };
      const signature = JSON.stringify({ id: snapshot.id, ...base, ...values });
      if (!request.current || request.current.signature !== signature)
        request.current = { signature, key: crypto.randomUUID() };
      const key = request.current.key;
      drafts.write(accountId, snapshot, values, request.current);
      if (values.action === 'role')
        return adminUsersApi.role(accountId, snapshot.id, { ...base, role: values.role }, key);
      if (values.action === 'sessions')
        return adminUsersApi.sessions(accountId, snapshot.id, base, key);
      if (values.action === 'deactivation') {
        if (
          !snapshot.deactivationRequests.some(
            (application) =>
              application.id === values.applicationId && application.status === 'pending',
          )
        )
          throw new Error('请选择仍待处理的停用申请');
        return adminUsersApi.deactivation(
          accountId,
          snapshot.id,
          values.applicationId,
          { ...base, decision: values.decision },
          key,
        );
      }
      return adminUsersApi.status(
        accountId,
        snapshot.id,
        {
          ...base,
          status: values.action === 'ban' ? 'banned' : 'active',
          scope: values.action === 'ban' ? values.scope : 'account_only',
        },
        key,
      );
    },
    retry: false,
    onSuccess: async (result, command) => {
      setSnapshot(result.data);
      request.current = null;
      drafts.clear(accountId, snapshot.id);
      setRestored(false);
      form.reset({
        action: 'role',
        role: result.data.role,
        scope: 'account_only',
        applicationId:
          result.data.deactivationRequests.find((request) => request.status === 'pending')?.id ??
          '',
        decision: 'approve',
        reason: '',
        confirmed: false,
      });
      setNotice(
        command.action === 'deactivation'
          ? command.decision === 'approve'
            ? '停用申请已批准，账号已停用'
            : '停用申请已驳回，账号保持当前状态'
          : '管理操作已保存，目标账号的会话状态已更新',
      );
      await changed(result.data);
    },
  });
  const busy = mutation.isPending || reading;
  const dirty = form.formState.isDirty || restored;
  useEffect(() => {
    if (dirty) drafts.write(accountId, snapshot, form.getValues(), request.current);
    else drafts.clear(accountId, snapshot.id);
  }, [dirty, values, accountId, snapshot, drafts, form]);
  useUnsavedDraft(dirty, '用户管理还有未提交的操作与理由，确定离开吗');
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  function dismiss() {
    if (busy || (dirty && !window.confirm('尚有未提交的用户管理操作，确定放弃输入并关闭吗')))
      return;
    form.reset({
      action: 'role',
      role: snapshot.role,
      scope: 'account_only',
      applicationId:
        snapshot.deactivationRequests.find((request) => request.status === 'pending')?.id ?? '',
      decision: 'approve',
      reason: '',
      confirmed: false,
    });
    setRestored(false);
    drafts.clear(accountId, snapshot.id);
    onDirty(false);
    close();
  }
  async function refresh() {
    setReading(true);
    try {
      const latest = await reload();
      if (latest) {
        setSnapshot(latest);
        mutation.reset();
        setNotice('已读取最新账号状态，操作选项和理由已保留，请核对后重新提交');
      } else setNotice('暂时无法读取最新账号状态，当前输入已保留');
    } finally {
      setReading(false);
    }
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) dismiss();
      }}
    >
      <SheetContent className="sm:max-w-2xl" showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>用户详情</SheetTitle>
          <SheetDescription>核对账号、处理范围与记录后再执行管理操作</SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-6 px-4 pb-5 sm:px-6">
          <section aria-label="用户信息" className="flex min-w-0 flex-col gap-3">
            <h2 className="break-words text-xl font-semibold">{snapshot.username}</h2>
            <p className="[overflow-wrap:anywhere]" translate="no">
              {snapshot.email}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{roleLabel(snapshot.role)}</Badge>
              <Badge variant={snapshot.status === 'active' ? 'outline' : 'secondary'}>
                {statusLabel(snapshot.status)}
              </Badge>
              {snapshot.pendingDeactivation && <Badge variant="outline">申请停用</Badge>}
            </div>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">邮箱验证</dt>
                <dd>{snapshot.emailVerified ? '已验证' : '未验证'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">身份验证器</dt>
                <dd>{snapshot.mfaEnabled ? '已绑定' : '未绑定'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">作品</dt>
                <dd>{snapshot.personaCount}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">有效会话</dt>
                <dd>{snapshot.activeSessionCount}</dd>
              </div>
              <div className="col-span-2 min-w-0">
                <dt className="text-muted-foreground">账号 ID</dt>
                <dd className="[overflow-wrap:anywhere]">{snapshot.id}</dd>
              </div>
            </dl>
          </section>
          <AdminUserContentTabs accountId={accountId} id={snapshot.id}>
            <FormNotice error={mutation.error} message={notice} />
            <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>
              {reading ? '正在读取…' : '读取最新账号状态'}
            </Button>
            <form
              noValidate
              onSubmit={form.handleSubmit((value) => {
                setNotice(undefined);
                mutation.mutate(value);
              })}
            >
              <FieldGroup>
                <Controller
                  control={form.control}
                  name="action"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel>管理操作</FieldLabel>
                      <ToggleGroup
                        aria-label="管理操作"
                        variant="outline"
                        value={[field.value]}
                        disabled={busy}
                        onValueChange={(values) => {
                          const parsed = ActionSchema.safeParse(values[0]);
                          if (parsed.success) {
                            field.onChange(parsed.data);
                            form.setValue('confirmed', false);
                            if (parsed.data === 'deactivation') {
                              form.setValue('applicationId', pending[0]?.id ?? '');
                              form.setValue('decision', 'approve');
                            }
                          }
                        }}
                        className="grid w-full grid-cols-2 gap-2"
                      >
                        {Object.entries(actionLabels).map(([value, label]) => (
                          <ToggleGroupItem
                            key={value}
                            value={value}
                            className={cn('min-h-11', value === 'deactivation' && 'col-span-2')}
                            disabled={
                              (value === 'ban' && snapshot.status !== 'active') ||
                              (value === 'restore' && snapshot.status !== 'banned') ||
                              (value === 'deactivation' && pending.length === 0)
                            }
                          >
                            {label}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      <FieldDescription>{actionHelp[action]}</FieldDescription>
                    </Field>
                  )}
                />
                {action === 'role' && (
                  <Controller
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <AdminUserChoice
                        id="admin-user-new-role"
                        label="新角色"
                        value={field.value}
                        onChange={field.onChange}
                        options={userRoles}
                        disabled={busy}
                      />
                    )}
                  />
                )}
                {action === 'deactivation' && (
                  <>
                    <Controller
                      control={form.control}
                      name="applicationId"
                      render={({ field }) => (
                        <Field data-invalid={Boolean(form.formState.errors.applicationId)}>
                          <AdminUserChoice
                            id="admin-user-application"
                            label="待处理申请"
                            value={field.value}
                            disabled={busy}
                            options={pending.map((request) => ({
                              value: request.id,
                              label:
                                new Date(request.createdAt).toLocaleString('zh-CN') + ' 提交的申请',
                            }))}
                            onChange={(value) => {
                              field.onChange(value);
                              form.setValue('confirmed', false);
                            }}
                          />
                          <FieldError errors={[form.formState.errors.applicationId]} />
                        </Field>
                      )}
                    />
                    <section
                      aria-label="当前停用申请"
                      className="flex min-w-0 flex-col gap-2 rounded-lg border p-4"
                    >
                      <h3 className="font-medium">申请原文</h3>
                      {selectedApplication ? (
                        <p
                          className="max-h-[45dvh] overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]"
                          tabIndex={0}
                        >
                          {selectedApplication.reason}
                        </p>
                      ) : (
                        <p className="text-muted-foreground">
                          请选择仍待处理的申请，处理决定只作用于所选申请
                        </p>
                      )}
                      {selectedApplication?.status !== 'pending' && (
                        <p className="text-sm text-destructive">
                          所选申请已撤回或已处理，请重新选择
                        </p>
                      )}
                    </section>
                    <Controller
                      control={form.control}
                      name="decision"
                      render={({ field }) => (
                        <AdminUserChoice
                          id="admin-user-decision"
                          label="处理决定"
                          value={field.value}
                          disabled={busy}
                          options={[
                            { value: 'approve', label: '批准停用' },
                            { value: 'reject', label: '驳回申请' },
                          ]}
                          onChange={(value) => {
                            field.onChange(value);
                            form.setValue('confirmed', false);
                          }}
                        />
                      )}
                    />
                  </>
                )}
                {action === 'ban' && (
                  <Controller
                    control={form.control}
                    name="scope"
                    render={({ field }) => (
                      <AdminUserChoice
                        id="admin-user-ban-scope"
                        label="封禁范围"
                        value={field.value}
                        onChange={field.onChange}
                        disabled={busy}
                        options={[
                          { value: 'account_only', label: '仅封禁账号' },
                          { value: 'account_and_personas', label: '封禁账号并下架其全部正常作品' },
                        ]}
                      />
                    )}
                  />
                )}
                <Field data-invalid={Boolean(form.formState.errors.reason)}>
                  <FieldLabel htmlFor="admin-user-reason">处理理由</FieldLabel>
                  <Textarea
                    id="admin-user-reason"
                    autoComplete="off"
                    rows={4}
                    className="max-h-[45dvh] overflow-y-auto"
                    disabled={busy}
                    {...form.register('reason')}
                    aria-invalid={Boolean(form.formState.errors.reason)}
                  />
                  <FieldDescription>填写本次决定的依据，最多 2000 字</FieldDescription>
                  <FieldError errors={[form.formState.errors.reason]} />
                </Field>
                <Controller
                  control={form.control}
                  name="confirmed"
                  render={({ field }) => (
                    <Field data-invalid={Boolean(form.formState.errors.confirmed)}>
                      <FieldLabel
                        htmlFor="admin-user-confirm"
                        className="min-h-11 cursor-pointer items-center"
                      >
                        <Checkbox
                          id="admin-user-confirm"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={busy}
                          aria-invalid={Boolean(form.formState.errors.confirmed)}
                        />
                        我已核对账号、操作与影响范围
                      </FieldLabel>
                      <FieldError errors={[form.formState.errors.confirmed]} />
                    </Field>
                  )}
                />
                <div className="flex flex-wrap gap-3">
                  <SubmitButton
                    pending={mutation.isPending}
                    disabled={
                      reading ||
                      (action === 'role' && desiredRole === snapshot.role) ||
                      (action === 'deactivation' && selectedApplication?.status !== 'pending')
                    }
                  >
                    确认执行
                  </SubmitButton>
                  <Button type="button" variant="outline" disabled={busy} onClick={dismiss}>
                    关闭详情
                  </Button>
                </div>
              </FieldGroup>
            </form>
            {snapshot.id !== accountId && (
              <AdminDeleteDialog
                accountId={accountId}
                target={{
                  kind: 'user',
                  id: snapshot.id,
                  label: snapshot.username,
                  revision: snapshot.securityVersion,
                }}
                disabled={busy || dirty}
                deleted={() => {
                  drafts.clear(accountId, snapshot.id);
                  onDirty(false);
                  close();
                }}
              />
            )}
            <AdminDeactivationHistory requests={snapshot.deactivationRequests} />
            <section aria-label="管理记录" className="flex min-w-0 flex-col gap-4">
              <h2 className="text-lg font-semibold">最近管理记录</h2>
              {snapshot.records.length === 0 ? (
                <p className="text-muted-foreground">还没有管理操作记录</p>
              ) : (
                <ol className="flex flex-col gap-4">
                  {snapshot.records.map((record) => (
                    <li key={record.id} className="flex min-w-0 flex-col gap-2 border-t pt-4">
                      <p className="font-medium">
                        {recordLabels[record.action]} · {record.actor.username}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(record.createdAt).toLocaleString('zh-CN')} · 撤销{' '}
                        {record.revokedSessions} 个会话
                        {record.scope === 'account_and_personas'
                          ? ` · 下架 ${record.affectedPersonas} 个作品`
                          : ''}
                      </p>
                      <p
                        className="max-h-48 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]"
                        tabIndex={0}
                      >
                        {record.reason}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </AdminUserContentTabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AdminUserDetail({
  id,
  accountId,
  open,
  close,
  changed,
  onDirty,
}: {
  id: string;
  accountId: string;
  open: boolean;
  close: () => void;
  changed: (value: Snapshot) => Promise<void>;
  onDirty: (value: boolean) => void;
}) {
  const query = useQuery({
    queryKey: [...adminUsersKey(accountId), 'detail', id],
    queryFn: ({ signal }) => adminUsersApi.detail(accountId, id, signal),
    enabled: open,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (query.data)
    return (
      <UserDetailForm
        initial={query.data.data}
        accountId={accountId}
        open={open}
        close={close}
        changed={changed}
        onDirty={onDirty}
        reload={async () => {
          const result = await query.refetch();
          return result.isError ? undefined : result.data?.data;
        }}
      />
    );
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>用户详情</SheetTitle>
          <SheetDescription>读取有权限访问的账号信息</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 p-4">
          {query.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <FormNotice error={query.error} />
              <Button onClick={() => void query.refetch()}>重试读取用户</Button>
            </>
          )}
          <Button variant="outline" onClick={close}>
            关闭详情
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
