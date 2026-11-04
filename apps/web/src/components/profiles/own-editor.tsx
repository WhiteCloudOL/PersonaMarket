'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ProfileContentSchema,
  type ProfileContent,
  type OwnProfile,
} from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Textarea } from '@personamarket/ui/components/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@personamarket/ui/components/field';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@personamarket/ui/components/alert-dialog';
import { Badge } from '@personamarket/ui/components/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@personamarket/ui/components/avatar';
import { profilesApi, profilesKey } from '@/lib/profiles-api';
import { publicMediaSettingsQuery } from '@/lib/media-settings-api';
import { FormNotice } from '../auth/auth-fields';
import { useUnsavedDraft } from '../personas/use-unsaved-draft';
import { ProfileContentView, profileStatuses } from './content';
import { AvatarCropDialog } from './avatar-crop-dialog';

export function OwnProfileEditor({
  accountId,
  username,
  initial,
}: {
  accountId: string;
  username: string;
  initial: OwnProfile;
}) {
  const media = useQuery(publicMediaSettingsQuery);
  const mediaSettings = media.isError ? undefined : media.data?.data;
  const client = useQueryClient(),
    form = useForm<ProfileContent>({
      resolver: zodResolver(ProfileContentSchema),
      defaultValues: initial.content,
    });
  const links = useFieldArray({ control: form.control, name: 'links' });
  const [workspace, setWorkspace] = useState(initial),
    [candidate, setCandidate] = useState<OwnProfile>();
  const [confirmation, setConfirmation] = useState<'submit' | 'withdraw'>(),
    [notice, setNotice] = useState<string>();
  const [cropFile, setCropFile] = useState<File>();
  const avatarInput = useRef<HTMLInputElement>(null);
  const nonce = useRef<{ signature: string; key: string } | undefined>(undefined);
  const dirty = form.formState.isDirty;
  useUnsavedDraft(dirty, '个人资料还有未保存输入，确定离开吗');
  async function refresh() {
    const result = await profilesApi.own(accountId);
    setWorkspace(result.data);
    client.setQueryData([...profilesKey(accountId), 'own'], result);
    return result.data;
  }
  const save = useMutation({
    mutationFn: (content: ProfileContent) =>
      profilesApi.save(accountId, { content, expectedRevision: workspace.revision }),
    retry: false,
    onSuccess: (result) => {
      setWorkspace(result.data);
      setCandidate(undefined);
      form.reset(result.data.content);
      client.setQueryData([...profilesKey(accountId), 'own'], result);
      setNotice('草稿已保存，审核通过后才会更新公开资料');
    },
  });
  const read = useMutation({
    mutationFn: () => profilesApi.own(accountId),
    retry: false,
    onSuccess: (result) => setCandidate(result.data),
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      if (!mediaSettings) throw new Error('请先重新读取图片设置');
      if (!mediaSettings.uploadsEnabled) throw new Error('管理员已关闭本地图片上传');
      if (file.size > mediaSettings.maxImageKiB * 1024) throw new Error('头像超过当前图片大小限制');
      return profilesApi.avatar(accountId, file);
    },
    retry: false,
    gcTime: 0,
    onSuccess: (result) => {
      form.setValue('avatarAssetId', result.data.id, { shouldDirty: true, shouldValidate: true });
      setNotice('裁切后的头像已保存为 WebP，请保存草稿并提交审核');
    },
  });
  const action = useMutation({
    mutationFn: async (kind: 'submit' | 'withdraw') => {
      const pending = workspace.latestSubmission;
      const signature = JSON.stringify({
        kind,
        revision: workspace.revision,
        pending: pending?.id,
        pendingRevision: pending?.revision,
      });
      if (nonce.current?.signature !== signature)
        nonce.current = { signature, key: crypto.randomUUID() };
      if (kind === 'submit')
        return profilesApi.submit(
          accountId,
          { expectedDraftRevision: workspace.revision, confirmed: true },
          nonce.current.key,
        );
      if (!pending || pending.status !== 'PENDING') throw Error('待审状态已变化，请重新读取资料');
      return profilesApi.withdraw(
        accountId,
        pending.id,
        { expectedRevision: pending.revision, confirmed: true },
        nonce.current.key,
      );
    },
    retry: false,
    onSuccess: async () => {
      nonce.current = undefined;
      setConfirmation(undefined);
      setNotice('操作已完成，正在更新审核状态…');
      try {
        await refresh();
        setNotice('审核状态已更新，草稿输入继续保留');
      } catch {
        setNotice('操作已完成，审核状态暂时无法刷新，请读取最新资料后核对');
      }
      void client.invalidateQueries({ queryKey: [...profilesKey(accountId), 'history'] });
      void client.invalidateQueries({ queryKey: [...profilesKey(accountId), 'records'] });
    },
    onError: () => setConfirmation(undefined),
  });
  const busy = save.isPending || upload.isPending || action.isPending || read.isPending;
  const pending = workspace.latestSubmission?.status === 'PENDING';
  const avatar = useWatch({ control: form.control, name: 'avatarAssetId' });
  return (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {cropFile && (
        <AvatarCropDialog
          file={cropFile}
          returnFocus={avatarInput}
          onUpload={upload.mutateAsync}
          onClosed={() => setCropFile(undefined)}
        />
      )}
      <form
        noValidate
        onSubmit={form.handleSubmit((content) => save.mutate(content))}
        className="flex min-w-0 flex-col gap-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" role="status">
            {dirty ? '有未保存修改' : '草稿修订 ' + workspace.revision}
            {pending ? ' · 等待审核' : ''}
          </p>
          <Button type="submit" disabled={busy}>
            {save.isPending ? '正在保存…' : '保存草稿'}
          </Button>
        </div>
        <FormNotice error={save.error ?? action.error ?? read.error} message={notice} />
        {save.isError || action.isError ? (
          <Button type="button" variant="outline" onClick={() => read.mutate()} disabled={busy}>
            读取最新资料并保留输入
          </Button>
        ) : null}
        {candidate && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>核对服务器草稿</h2>
              </CardTitle>
              <CardDescription>
                服务器为修订 {candidate.revision}，当前输入仍完整保留
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ProfileContentView
                content={candidate.content}
                avatarSrc={
                  candidate.content.avatarAssetId
                    ? '/api/v1/me/assets/' + candidate.content.avatarAssetId
                    : null
                }
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setWorkspace(candidate);
                  setCandidate(undefined);
                  save.reset();
                  action.reset();
                  setNotice('已采用最新修订，核对输入后再次保存');
                }}
              >
                保留输入并采用最新修订
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (window.confirm('确定放弃当前未保存输入并载入服务器草稿吗')) {
                    form.reset(candidate.content);
                    setWorkspace(candidate);
                    setCandidate(undefined);
                    save.reset();
                    action.reset();
                  }
                }}
              >
                放弃输入并载入服务器草稿
              </Button>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>向读者介绍自己</h2>
            </CardTitle>
            <CardDescription>这里只维护公开资料，邮箱和账号安全单独管理</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={Boolean(form.formState.errors.displayName)}>
                <FieldLabel htmlFor="profile-name">公开昵称</FieldLabel>
                <Input
                  id="profile-name"
                  autoComplete="off"
                  disabled={busy}
                  aria-invalid={Boolean(form.formState.errors.displayName)}
                  {...form.register('displayName')}
                />
                <FieldDescription>最多 60 个字符，不含首尾空格</FieldDescription>
                <FieldError errors={[form.formState.errors.displayName]} />
              </Field>
              <Field data-invalid={Boolean(form.formState.errors.avatarAssetId)}>
                <FieldLabel htmlFor="profile-avatar">资料头像</FieldLabel>
                <Input
                  id="profile-avatar"
                  ref={avatarInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy || !mediaSettings?.uploadsEnabled}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) {
                      if (!mediaSettings || !mediaSettings.uploadsEnabled) {
                        form.setError('avatarAssetId', { message: '请先核对图片上传设置' });
                        return;
                      }
                      if (file.size > mediaSettings.maxImageKiB * 1024) {
                        form.setError('avatarAssetId', {
                          message: `请选择 ${mediaSettings.maxImageKiB} KiB 以内的图片`,
                        });
                        return;
                      }
                      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                        form.setError('avatarAssetId', {
                          message: '请选择 JPEG、PNG 或 WebP 图片',
                        });
                        return;
                      }
                      form.clearErrors('avatarAssetId');
                      setCropFile(file);
                    }
                  }}
                />
                <FieldDescription>
                  选择图片后在弹窗裁切，保存为 WebP，审核通过后公开
                </FieldDescription>
                {media.isPending && <FieldDescription>正在读取图片上传限制…</FieldDescription>}
                {mediaSettings && (
                  <FieldDescription>
                    {mediaSettings.uploadsEnabled
                      ? `原图最大 ${mediaSettings.maxImageKiB} KiB`
                      : '本地图片上传已关闭，已有头像可以保留或移除'}
                  </FieldDescription>
                )}
                {media.isError && (
                  <>
                    <FormNotice error={media.error} />
                    <Button type="button" variant="outline" onClick={() => void media.refetch()}>
                      重新读取图片设置
                    </Button>
                  </>
                )}
                {avatar && (
                  <div className="flex flex-col items-start gap-3">
                    <Avatar className="size-20">
                      <AvatarImage
                        src={'/api/v1/me/assets/' + avatar}
                        alt="当前草稿头像"
                        width={80}
                        height={80}
                      />
                      <AvatarFallback>头像</AvatarFallback>
                    </Avatar>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        form.setValue('avatarAssetId', null, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    >
                      移除草稿头像
                    </Button>
                  </div>
                )}
                <FieldError errors={[form.formState.errors.avatarAssetId]} />
              </Field>
              <Field data-invalid={Boolean(form.formState.errors.bio)}>
                <FieldLabel htmlFor="profile-bio">公开简介</FieldLabel>
                <Textarea
                  id="profile-bio"
                  rows={5}
                  autoComplete="off"
                  disabled={busy}
                  aria-invalid={Boolean(form.formState.errors.bio)}
                  {...form.register('bio')}
                />
                <FieldDescription>最多 1000 个字符，按纯文本展示并保留换行</FieldDescription>
                <FieldError errors={[form.formState.errors.bio]} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>公开链接</h2>
            </CardTitle>
            <CardDescription>最多 5 个，请只填写愿意向读者公开的地址</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {links.fields.map((row, index) => (
                <FieldGroup key={row.id} className="rounded-xl border p-4">
                  <Field data-invalid={Boolean(form.formState.errors.links?.[index]?.label)}>
                    <FieldLabel htmlFor={'profile-link-label-' + index}>
                      链接名称 {index + 1}
                    </FieldLabel>
                    <Input
                      id={'profile-link-label-' + index}
                      autoComplete="off"
                      disabled={busy}
                      aria-invalid={Boolean(form.formState.errors.links?.[index]?.label)}
                      {...form.register(`links.${index}.label`)}
                    />
                    <FieldError errors={[form.formState.errors.links?.[index]?.label]} />
                  </Field>
                  <Field data-invalid={Boolean(form.formState.errors.links?.[index]?.url)}>
                    <FieldLabel htmlFor={'profile-link-url-' + index}>
                      链接地址 {index + 1}
                    </FieldLabel>
                    <Input
                      id={'profile-link-url-' + index}
                      type="url"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={busy}
                      aria-invalid={Boolean(form.formState.errors.links?.[index]?.url)}
                      {...form.register(`links.${index}.url`)}
                    />
                    <FieldError errors={[form.formState.errors.links?.[index]?.url]} />
                  </Field>
                  <Button
                    type="button"
                    variant="outline"
                    className="self-start"
                    disabled={busy}
                    onClick={() => links.remove(index)}
                  >
                    移除链接 {index + 1}
                  </Button>
                </FieldGroup>
              ))}
              <FieldError errors={[form.formState.errors.links]} />
              <Button
                type="button"
                variant="outline"
                disabled={busy || links.fields.length >= 5}
                className="self-start"
                onClick={() => links.append({ label: '', url: '' })}
              >
                添加公开链接
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>
      </form>
      <aside className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-28" aria-label="资料公开状态">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>提交与公开状态</h2>
            </CardTitle>
            <CardDescription>保存与审核分开进行，旧获批资料继续展示</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {workspace.latestSubmission && (
              <>
                <Badge className="self-start">
                  {profileStatuses[workspace.latestSubmission.status]}
                </Badge>
                {workspace.latestSubmission.reason && (
                  <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">
                    {workspace.latestSubmission.reason}
                  </p>
                )}
              </>
            )}
            {workspace.visibility === 'hidden' && (
              <p className="text-sm leading-6">公开资料已隐藏，新的审核通过不会自动恢复公开</p>
            )}
            <Button
              variant="outline"
              disabled={busy || dirty || pending || workspace.revision === 0}
              onClick={() => setConfirmation('submit')}
            >
              提交资料审核
            </Button>
            {dirty && <p className="text-sm text-muted-foreground">先保存当前输入，再提交审核</p>}
            {pending && (
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmation('withdraw')}>
                撤回待审资料
              </Button>
            )}
            <Link className={buttonVariants({ variant: 'ghost' })} href={'/users/' + username}>
              查看公开主页
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>当前获批资料</h2>
            </CardTitle>
            <CardDescription>
              {workspace.published ? '展示上一次获批的内容' : '首次审核通过前以用户名展示'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {workspace.published ? (
              <ProfileContentView
                content={workspace.published.snapshot}
                avatarSrc={
                  workspace.published.snapshot.avatarAssetId
                    ? '/api/v1/me/assets/' + workspace.published.snapshot.avatarAssetId
                    : null
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">{username}</p>
            )}
          </CardContent>
        </Card>
      </aside>
      <AlertDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation === 'withdraw' ? '撤回待审资料' : '提交资料审核'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === 'withdraw'
                ? '撤回后可继续修改和重提，旧获批资料保持原样'
                : '只提交已保存的草稿，审核通过后才会更新公开资料'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>返回核对</AlertDialogCancel>
            <Button
              disabled={busy}
              onClick={() => {
                if (confirmation) action.mutate(confirmation);
              }}
            >
              {busy ? '正在处理…' : '确认' + (confirmation === 'withdraw' ? '撤回' : '提交')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
