'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import type { PersonaDraft } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Field, FieldDescription, FieldLabel } from '@personamarket/ui/components/field';
import { assetsApi } from '@/lib/assets-api';
import { FormNotice } from '../auth/auth-fields';
import { imageAccept, personaAssetsKey, usePersonaImageUpload } from './persona-media';

export function PersonaCoverField() {
  const form = useFormContext<PersonaDraft>();
  const cover = useWatch({ control: form.control, name: 'coverAssetId' });
  const [picking, setPicking] = useState(false);
  const setCover = (id?: string) => form.setValue('coverAssetId', id, { shouldDirty: true });
  const { accountId, settings, upload } = usePersonaImageUpload('content', setCover);
  const assets = useQuery({
    queryKey: personaAssetsKey,
    queryFn: assetsApi.list,
    enabled: picking && Boolean(accountId),
    select: (result) => result.data.filter((asset) => asset.purpose === 'content'),
    retry: false,
  });
  return (
    <Field>
      <FieldLabel htmlFor="persona-cover-file">作品封面</FieldLabel>
      {cover && (
        <div className="flex flex-wrap items-center gap-3">
          <Image
            src={'/api/v1/me/assets/' + cover}
            alt="当前作品封面"
            width={128}
            height={72}
            unoptimized
            className="aspect-video w-32 rounded-lg bg-muted object-contain"
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => setCover()}
            disabled={upload.isPending}
          >
            移除封面
          </Button>
        </div>
      )}
      <Input
        id="persona-cover-file"
        type="file"
        accept={imageAccept}
        aria-describedby="persona-cover-help"
        disabled={upload.isPending || !settings?.uploadsEnabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) upload.mutate(file);
        }}
      />
      <FieldDescription id="persona-cover-help">
        {accountId ? '选填。上传后直接用作作品封面。' : '选填，登录后可添加封面。'}
      </FieldDescription>
      {accountId && (
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          aria-expanded={picking}
          onClick={() => setPicking(!picking)}
          disabled={upload.isPending}
        >
          {picking ? '收起已有图片' : '选择已有图片'}
        </Button>
      )}
      {picking && accountId && (
        <div className="flex max-h-64 flex-wrap items-start gap-2 overflow-y-auto rounded-lg border p-2">
          {assets.isPending && <p role="status">正在读取图片…</p>}
          {assets.isError && (
            <Button type="button" variant="outline" onClick={() => void assets.refetch()}>
              读取失败，重试
            </Button>
          )}
          {assets.data?.length === 0 && <p>暂无已上传的作品图片</p>}
          {assets.data?.map((asset, index) => (
            <Button
              key={asset.id}
              type="button"
              variant="outline"
              className="h-auto px-1 py-1"
              aria-label={`将图片 ${index + 1} 设为封面`}
              onClick={() => {
                setCover(asset.id);
                setPicking(false);
              }}
            >
              <Image
                src={'/api/v1/me/assets/' + asset.id}
                alt=""
                width={72}
                height={48}
                unoptimized
                className="aspect-[3/2] w-18 rounded-sm bg-muted object-contain"
              />
            </Button>
          ))}
        </div>
      )}
      <FormNotice error={upload.error} message={upload.isPending ? '正在上传封面…' : undefined} />
    </Field>
  );
}

export function PersonaEvidenceField() {
  const form = useFormContext<PersonaDraft>();
  const evidence = useWatch({ control: form.control, name: 'evidenceAssetIds' });
  const { accountId, settings, upload } = usePersonaImageUpload('evidence', (id) => {
    const current = form.getValues('evidenceAssetIds');
    if (current.length < 5 && !current.includes(id))
      form.setValue('evidenceAssetIds', [...current, id], { shouldDirty: true });
  });
  return (
    <Field>
      <FieldLabel htmlFor="persona-evidence-file">上传私有授权证据</FieldLabel>
      <Input
        id="persona-evidence-file"
        type="file"
        accept={imageAccept}
        aria-describedby="persona-evidence-help"
        disabled={upload.isPending || !settings?.uploadsEnabled || evidence.length >= 5}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) upload.mutate(file);
        }}
      />
      <FieldDescription id="persona-evidence-help">
        选填，仅自己与相关审核人员可见。已附 {evidence.length} / 5 份。
        {!accountId && ' 登录后可添加。'}
      </FieldDescription>
      {evidence.map((id, index) => (
        <div key={id} className="flex flex-wrap items-center gap-2">
          <a
            href={'/api/v1/me/assets/' + id}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
          >
            证据 {index + 1}（新窗口）
          </a>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              form.setValue(
                'evidenceAssetIds',
                evidence.filter((item) => item !== id),
                { shouldDirty: true },
              )
            }
          >
            移除证据 {index + 1}
          </Button>
        </div>
      ))}
      <FormNotice error={upload.error} message={upload.isPending ? '正在上传证据…' : undefined} />
    </Field>
  );
}
