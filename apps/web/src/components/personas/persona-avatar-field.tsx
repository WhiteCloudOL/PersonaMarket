'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { PERSONA_AVATAR_MAX_BYTES, type PersonaDraft } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Field, FieldLabel, FieldDescription } from '@personamarket/ui/components/field';
import { assetsApi } from '@/lib/assets-api';
import { FormNotice } from '../auth/auth-fields';
import { AvatarCropDialog } from '../media/avatar-crop-dialog';
import {
  imageAccept,
  personaAssetsKey,
  personaMediaUploadKey,
  usePersonaMedia,
} from './persona-media';

export function PersonaAvatarField() {
  const form = useFormContext<PersonaDraft>();
  const id = useWatch({ control: form.control, name: 'avatarAssetId' });
  const { accountId, policy, client, ownsSession } = usePersonaMedia();
  const input = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<{ file: File; accountId: string }>();
  const [selectionError, setSelectionError] = useState<string>();
  const upload = useMutation({
    mutationKey: personaMediaUploadKey,
    mutationFn: ({ file, accountId }: { file: File; accountId: string }) =>
      assetsApi.uploadAvatar(accountId, file),
    onSuccess: ({ data }, { accountId }) => {
      if (!ownsSession(accountId)) return;
      form.setValue('avatarAssetId', data.id, { shouldDirty: true });
      void client.invalidateQueries({ queryKey: personaAssetsKey });
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
        ref={input}
        id="persona-avatar-file"
        type="file"
        accept={imageAccept}
        aria-describedby="persona-avatar-help"
        disabled={
          upload.isPending || !accountId || policy.isError || !policy.data?.data.uploadsEnabled
        }
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file || !accountId) return;
          setSelectionError(undefined);
          if (file.size === 0 || file.size >= PERSONA_AVATAR_MAX_BYTES) {
            setSelectionError('请选择小于 10 MiB 的有效图片');
            return;
          }
          if (!imageAccept.split(',').includes(file.type)) {
            setSelectionError('请选择 JPEG、PNG 或 WebP 图片');
            return;
          }
          setCrop({ file, accountId });
        }}
      />
      <FieldDescription id="persona-avatar-help">
        选填。选择小于 10 MiB 的 JPEG、PNG 或 WebP，裁切后保存为 WebP。
        {!accountId && ' 登录后可上传。'}
        {policy.data?.data.uploadsEnabled === false && ' 本地上传暂未开放。'}
      </FieldDescription>
      {policy.isError && (
        <Button type="button" variant="outline" onClick={() => void policy.refetch()}>
          重试读取图片设置
        </Button>
      )}
      {crop && (
        <AvatarCropDialog
          file={crop.file}
          description="调整方框里的头像，确认后应用到人设草稿"
          returnFocus={input}
          onUpload={(file) => upload.mutateAsync({ file, accountId: crop.accountId })}
          onClosed={() => setCrop(undefined)}
        />
      )}
      <FormNotice
        error={selectionError}
        message={id && upload.data?.data.id === id ? '头像已上传，保存草稿后生效' : undefined}
      />
    </Field>
  );
}
