'use client';

import Image from 'next/image';
import { useFormContext, useWatch } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PERSONA_AVATAR_MAX_BYTES,
  type AuthContextResponse,
  type PersonaDraft,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Field, FieldLabel, FieldDescription } from '@personamarket/ui/components/field';
import { assetsApi } from '@/lib/assets-api';
import { authQuery } from '@/lib/auth-api';
import { publicMediaSettingsQuery } from '@/lib/media-settings-api';
import { FormNotice } from '../auth/auth-fields';

export const personaAvatarUploadKey = ['private', 'persona-avatar-upload'] as const;

export function PersonaAvatarField() {
  const form = useFormContext<PersonaDraft>();
  const id = useWatch({ control: form.control, name: 'avatarAssetId' });
  const account = useQuery(authQuery).data?.data;
  const media = useQuery({
    ...publicMediaSettingsQuery,
    enabled: account?.assurance === 'authenticated',
  });
  const client = useQueryClient();
  const upload = useMutation({
    mutationKey: personaAvatarUploadKey,
    mutationFn: (file: File) => {
      if (!account?.account || account.assurance !== 'authenticated') throw new Error('请先登录');
      if (file.size === 0 || file.size >= PERSONA_AVATAR_MAX_BYTES)
        throw new Error('请选择小于 10 MiB 的图片');
      return assetsApi.uploadAvatar(account.account.id, file);
    },
    onSuccess: ({ data }) => {
      const current = client.getQueryData<AuthContextResponse>(authQuery.queryKey)?.data;
      if (current?.assurance !== 'authenticated' || current.account?.id !== account?.account?.id)
        return;
      form.setValue('avatarAssetId', data.id, { shouldDirty: true });
      void client.invalidateQueries({ queryKey: ['private', 'assets'] });
    },
    gcTime: 0,
    retry: false,
  });
  return (
    <Field>
      <FieldLabel htmlFor="persona-avatar-file">人设头像</FieldLabel>
      {id && (
        <div className="flex flex-wrap items-center gap-3">
          <Image
            src={'/api/v1/me/assets/' + id}
            alt="当前人设头像"
            width={64}
            height={64}
            unoptimized
            className="size-16 rounded-xl object-cover"
          />
          <Button
            type="button"
            variant="ghost"
            disabled={upload.isPending}
            onClick={() => {
              form.setValue('avatarAssetId', undefined, { shouldDirty: true });
              upload.reset();
            }}
          >
            移除头像
          </Button>
        </div>
      )}
      <Input
        id="persona-avatar-file"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-describedby="persona-avatar-help"
        disabled={
          upload.isPending ||
          account?.assurance !== 'authenticated' ||
          media.isError ||
          !media.data?.data.uploadsEnabled
        }
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) upload.mutate(file);
          event.currentTarget.value = '';
        }}
      />
      <FieldDescription id="persona-avatar-help">
        选填。支持小于 10 MiB 的静态 JPEG、PNG 和 WebP，上传后仅保存压缩的 WebP。
        {account?.assurance !== 'authenticated' && ' 登录后可上传。'}
        {media.data?.data.uploadsEnabled === false && ' 本地上传暂未开放。'}
      </FieldDescription>
      {media.isError && (
        <Button type="button" variant="outline" onClick={() => void media.refetch()}>
          重试读取图片设置
        </Button>
      )}
      {upload.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          正在上传并压缩头像…
        </p>
      )}
      <FormNotice
        error={upload.error}
        message={id && upload.data?.data.id === id ? '头像已上传，保存草稿后生效' : undefined}
      />
    </Field>
  );
}
