'use client';

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ImagePlusIcon, LinkIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Field, FieldLabel } from '@personamarket/ui/components/field';
import { assetsApi } from '@/lib/assets-api';
import { FormNotice } from '../auth/auth-fields';
import { imageAccept, personaMediaUploadKey, usePersonaImageUpload } from './persona-media';

export function ReadmeImages({
  ready,
  rememberCursor,
  insertImage,
  children,
}: {
  ready: boolean;
  rememberCursor: (point?: { x: number; y: number }) => void;
  insertImage: (id: string) => void;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [showRemote, setShowRemote] = useState(false);
  const [url, setUrl] = useState('');
  const [fileError, setFileError] = useState<string>();
  const [job, setJob] = useState<{ id: string; accountId: string }>();
  const consumed = useRef<string>(undefined);
  const { accountId, settings, upload, ownsSession } = usePersonaImageUpload(
    'content',
    insertImage,
  );
  const remote = useMutation({
    mutationKey: personaMediaUploadKey,
    mutationFn: async () => {
      if (!accountId || !settings?.remoteImportsEnabled) throw new Error('在线图片导入暂不可用');
      const result = await assetsApi.queue(accountId, url.trim());
      return { id: result.data.id, accountId };
    },
    onSuccess: (result) => {
      if (ownsSession(result.accountId)) setJob(result);
    },
    gcTime: 0,
    retry: false,
  });
  const jobId = job?.accountId === accountId ? job?.id : undefined;
  const status = useQuery({
    queryKey: ['private', 'asset-job', jobId],
    queryFn: () => {
      if (!jobId) throw new Error('缺少导入任务');
      return assetsApi.job(jobId);
    },
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const state = query.state.data?.data.status;
      return query.state.status === 'error' || state === 'ready' || state === 'failed'
        ? false
        : 1000;
    },
    retry: false,
  });
  const result = status.data?.data;
  const complete = useEffectEvent((id: string) => {
    if (job && ownsSession(job.accountId)) insertImage(id);
  });
  useEffect(() => {
    if (!jobId || result?.status !== 'ready' || !result.assetId || consumed.current === jobId)
      return;
    consumed.current = jobId;
    complete(result.assetId);
  }, [jobId, result]);
  const importing = Boolean(jobId) && result?.status !== 'ready' && result?.status !== 'failed';
  const busy = upload.isPending || remote.isPending || importing;
  const canUpload = ready && !busy && Boolean(settings?.uploadsEnabled);
  const canImport = ready && !busy && Boolean(url.trim() && settings?.remoteImportsEnabled);
  const imageFile = (files: FileList) =>
    Array.from(files).find((file) => imageAccept.split(',').includes(file.type));
  function importImage() {
    if (!canImport) return;
    setFileError(undefined);
    rememberCursor();
    remote.mutate();
  }
  const remoteError =
    remote.error ?? status.error ?? (result?.status === 'failed' ? result.message : null);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="README 图片">
        <Button
          type="button"
          variant="outline"
          disabled={!canUpload}
          onClick={() => input.current?.click()}
        >
          <ImagePlusIcon data-icon="inline-start" aria-hidden />
          上传图片
        </Button>
        <input
          ref={input}
          type="file"
          name="readmeImage"
          accept={imageAccept}
          aria-label="上传作品图片"
          hidden
          disabled={!canUpload}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            setFileError(undefined);
            rememberCursor();
            upload.mutate(file);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          aria-expanded={showRemote}
          disabled={!ready || (!showRemote && !settings?.remoteImportsEnabled)}
          onClick={() => setShowRemote(!showRemote)}
        >
          <LinkIcon data-icon="inline-start" aria-hidden />
          在线图片
        </Button>
      </div>
      {showRemote && (
        <Field>
          <FieldLabel htmlFor="readme-image-url">在线图片地址</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="readme-image-url"
              type="url"
              name="readmeImageUrl"
              autoComplete="off"
              placeholder="https://图片地址…"
              className="min-w-48 flex-1"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                event.preventDefault();
                importImage();
              }}
            />
            <Button type="button" variant="outline" disabled={!canImport} onClick={importImage}>
              导入在线图片
            </Button>
          </div>
        </Field>
      )}
      {status.isError && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void status.refetch()}>
            重试读取导入结果
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setJob(undefined);
              remote.reset();
            }}
          >
            停止等待
          </Button>
        </div>
      )}
      <FormNotice
        error={fileError ?? upload.error ?? remoteError}
        message={
          upload.isPending
            ? '正在上传图片…'
            : busy && !status.isError
              ? '正在导入在线图片…'
              : undefined
        }
      />
      {!accountId && <p className="text-sm text-muted-foreground">登录后可上传或导入图片</p>}
      <div
        className="min-w-0"
        onPasteCapture={(event) => {
          const file = canUpload ? imageFile(event.clipboardData.files) : undefined;
          if (!file) return;
          event.preventDefault();
          event.stopPropagation();
          setFileError(undefined);
          rememberCursor();
          upload.mutate(file);
        }}
        onDragOverCapture={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDropCapture={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          event.stopPropagation();
          const file = imageFile(event.dataTransfer.files);
          if (!canUpload || !file) {
            setFileError(canUpload ? '请选择 JPEG、PNG 或 WebP 图片' : '当前无法上传图片');
            return;
          }
          setFileError(undefined);
          rememberCursor({ x: event.clientX, y: event.clientY });
          upload.mutate(file);
        }}
      >
        {children}
      </div>
      {settings?.uploadsEnabled && (
        <p className="text-xs text-muted-foreground">可把图片拖入编辑区或粘贴到光标处</p>
      )}
    </div>
  );
}
