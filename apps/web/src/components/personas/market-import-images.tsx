'use client';
import Image from 'next/image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  mediaSourceHostname,
  type MarketImportPreview,
  type MediaSettings,
} from '@personamarket/contracts';
import { CheckCircle2Icon, ImageIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Field, FieldLabel } from '@personamarket/ui/components/field';
import { marketImportsApi } from '@/lib/market-imports-api';
import { FormNotice } from '../auth/auth-fields';
import { usePrivateResult } from './use-private-result';
import { publicMediaSettingsQuery } from '@/lib/media-settings-api';
import { MediaPolicyNotice } from './media-policy-notice';

export const importImagesKey = (id: string) => ['private', 'market-import-images', id];
export function MarketImportImages({
  id,
  images,
}: {
  id: string;
  images: MarketImportPreview['images'];
}) {
  const policy = useQuery({ ...publicMediaSettingsQuery, enabled: images.length > 0 });
  if (!images.length)
    return (
      <p className="rounded-xl bg-muted/50 p-4 text-base text-muted-foreground">
        这个文件没有附带图片，可直接继续核对来源
      </p>
    );
  return (
    <div className="space-y-4">
      <MediaPolicyNotice policy={policy} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">图片与素材</h3>
        <span className="text-sm text-muted-foreground">
          {images.filter((image) => image.status === 'ready').length} / {images.length} 张已托管
        </span>
      </div>
      {images.map((image, index) => (
        <ImportImage
          key={image.id}
          id={id}
          image={image}
          index={index}
          settings={policy.isError ? undefined : policy.data?.data}
        />
      ))}
    </div>
  );
}
function ImportImage({
  id,
  image,
  index,
  settings,
}: {
  id: string;
  image: MarketImportPreview['images'][number];
  index: number;
  settings: MediaSettings | undefined;
}) {
  const client = useQueryClient();
  const guard = usePrivateResult();
  const remoteAllowed = (() => {
    if (!settings?.remoteImportsEnabled || !image.sourceUrl) return false;
    if (!settings.sourceDomains.length) return true;
    try {
      const hostname = mediaSourceHostname(new URL(image.sourceUrl).hostname);
      return (
        hostname !== undefined &&
        settings.sourceDomains.some((domain) => mediaSourceHostname(domain) === hostname)
      );
    } catch {
      return false;
    }
  })();
  const mutation = useMutation({
    mutationFn: async (file?: File) => {
      const accountId = guard.accountId();
      if (!settings) throw new Error('请先重新读取图片设置');
      if (file && !settings.uploadsEnabled) throw new Error('管理员已关闭本地图片上传');
      if (file && file.size > settings.maxImageKiB * 1024)
        throw new Error('源图片超过当前大小限制');
      if (!file && !remoteAllowed)
        throw new Error('当前图片设置不允许导入此来源，可核对设置或上传匹配的原图');
      const result = file
        ? await marketImportsApi.upload(accountId, id, image.id, file)
        : await marketImportsApi.queue(accountId, id, image.id);
      return { result, accountId };
    },
    onSuccess: ({ result, accountId }) => {
      if (guard.accepts(accountId)) client.setQueryData(importImagesKey(id), result);
    },
    retry: false,
    gcTime: 0,
  });
  const ready = image.status === 'ready';
  const processing = image.status === 'queued' || image.status === 'processing';
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label={`图片 ${index + 1}`}>
      <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center">
        {ready ? (
          <Image
            src={`/api/v1/me/market-imports/${id}/images/${image.id}`}
            alt={`已托管的第${index + 1}张图片`}
            width={64}
            height={64}
            unoptimized
            className="size-16 shrink-0 rounded-lg bg-muted object-cover"
          />
        ) : (
          <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <ImageIcon aria-hidden />
          </div>
        )}
        <div className="w-full min-w-0 space-y-1 sm:w-auto sm:flex-1">
          <p className="font-medium">
            图片 {index + 1}
            <span className="mt-1 block text-sm font-normal text-muted-foreground sm:mt-0 sm:ml-2 sm:inline">
              {(image.bytes / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} KiB ·{' '}
              {image.mimeType.replace('image/', '').toUpperCase()}
            </span>
          </p>
          <p
            role="status"
            className={
              'flex items-center gap-2 text-sm ' +
              (ready ? 'text-primary' : 'text-muted-foreground')
            }
          >
            {ready ? (
              <CheckCircle2Icon className="size-4" aria-hidden />
            ) : processing ? (
              <LoaderCircleIcon className="size-4 motion-safe:animate-spin" aria-hidden />
            ) : null}
            {ready
              ? '已校验并托管'
              : processing
                ? '正在安全导入…'
                : image.status === 'failed'
                  ? '导入未完成，请核对源文件后重试'
                  : '等待确认源图片'}
          </p>
        </div>
      </div>
      {image.sourceUrl && (
        <details className="min-w-0 text-sm">
          <summary className="min-h-11 cursor-pointer py-3 text-muted-foreground">
            查看文件声明的图片来源
          </summary>
          <p className="break-all rounded-lg bg-muted p-3 leading-6">{image.sourceUrl}</p>
        </details>
      )}
      {!ready && (
        <div className="space-y-3">
          {image.sourceUrl && (
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={mutation.isPending || processing || !remoteAllowed}
              onClick={() => mutation.mutate(undefined)}
            >
              确认导入在线图片
            </Button>
          )}
          {image.sourceUrl && settings?.remoteImportsEnabled && !remoteAllowed && (
            <p className="text-sm text-muted-foreground">
              当前来源域未开放，可上传匹配原图或联系管理员核对
            </p>
          )}
          <Field>
            <FieldLabel htmlFor={'import-image-' + image.id}>上传匹配的原图</FieldLabel>
            <Input
              id={'import-image-' + image.id}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={mutation.isPending || !settings?.uploadsEnabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) mutation.mutate(file);
                event.currentTarget.value = '';
              }}
            />
          </Field>
          <p className="text-sm leading-6 text-muted-foreground">
            原图的大小、类型和哈希须与清单一致，托管时会去除图片元数据
          </p>
        </div>
      )}
      <FormNotice error={mutation.error} />
      {mutation.isError && (
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-11 max-w-full whitespace-normal"
          disabled={!settings || (mutation.variables ? !settings.uploadsEnabled : !remoteAllowed)}
          onClick={() => mutation.mutate(mutation.variables)}
        >
          重试本张图片
        </Button>
      )}
    </section>
  );
}
