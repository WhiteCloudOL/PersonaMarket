'use client';
import Image from 'next/image';
import { useEffect, useState, useCallback } from 'react';
import { useFormContext } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PersonaDraft } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Field, FieldLabel, FieldDescription } from '@personamarket/ui/components/field';
import { Badge } from '@personamarket/ui/components/badge';
import { assetsApi } from '@/lib/assets-api';
import { publicMediaSettingsQuery } from '@/lib/media-settings-api';
import { FormNotice } from '../auth/auth-fields';
import { EditorSection } from './draft-fields';
import { MediaPolicyNotice } from './media-policy-notice';
const key = ['private', 'assets'] as const;
function ImportStatus({ id, done }: { id: string; done: () => void }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['private', 'asset-job', id],
    queryFn: () => assetsApi.job(id),
    retry: false,
    refetchInterval: (query) =>
      ['ready', 'failed'].includes(query.state.data?.data.status ?? '') ? false : 1000,
  });
  const status = query.data?.data.status;
  useEffect(() => {
    if (status === 'ready') {
      void client.invalidateQueries({ queryKey: key });
    }
    if (status === 'ready' || status === 'failed') done();
  }, [client, done, status]);
  if (query.isError)
    return (
      <>
        <FormNotice error={query.error.message} />
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          重试读取导入结果
        </Button>
      </>
    );
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {status === 'ready'
        ? '图片已导入，请在下方选择引用'
        : (query.data?.data.message ?? '正在安全下载与处理图片…')}
    </p>
  );
}
export function AssetLibrary({ step = '04' }: { step?: string }) {
  const policy = useQuery(publicMediaSettingsQuery);
  const settings = policy.isError ? undefined : policy.data?.data;
  const form = useFormContext<PersonaDraft>();
  const client = useQueryClient();
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const importDone = useCallback(() => setImported(true), []);
  const query = useQuery({ queryKey: key, queryFn: assetsApi.list, retry: false });
  const personaAssets = query.data?.data.filter((asset) => asset.purpose !== 'avatar') ?? [];
  const upload = useMutation({
    mutationFn: ({ file, purpose }: { file: File; purpose: 'content' | 'evidence' }) => {
      if (!settings) throw new Error('请先重新读取图片设置');
      if (!settings.uploadsEnabled) throw new Error('管理员已关闭本地图片上传');
      if (file.size > settings.maxImageKiB * 1024) throw new Error('图片超过当前大小限制');
      return assetsApi.upload(file, purpose);
    },
    gcTime: 0,
    retry: false,
    onSuccess: () => {
      setMessage('图片已处理并保存在私有素材库，请选择使用位置');
      void client.invalidateQueries({ queryKey: key });
    },
  });
  const remote = useMutation({
    mutationFn: () => {
      if (!settings) throw new Error('请先重新读取图片设置');
      if (!settings.remoteImportsEnabled) throw new Error('管理员已关闭在线图片导入');
      return assetsApi.queue(url);
    },
    retry: false,
    onSuccess: (result) => {
      setJobId(result.data.id);
      setImported(false);
    },
  });
  const pick = (purpose: 'content' | 'evidence', file: File | undefined) => {
    if (!file) return;
    if (!settings || !settings.uploadsEnabled) {
      setMessage('请先核对当前图片上传设置');
      return;
    }
    if (file.size > settings.maxImageKiB * 1024) {
      setMessage(`请选择 ${settings.maxImageKiB} KiB 以内的图片`);
      return;
    }
    upload.mutate({ file, purpose });
  };
  const attachImage = (id: string, target: 'readme' | 'avatar' | 'cover' | 'evidence') => {
    if (target === 'readme') {
      const current = form.getValues('readmeMarkdown');
      form.setValue('readmeMarkdown', current + '\n\n![图片](asset://' + id + ')', {
        shouldDirty: true,
      });
      setMessage('图片已添加到 README');
    } else if (target === 'evidence') {
      const ids = form.getValues('evidenceAssetIds');
      if (ids.length >= 5) {
        setMessage('最多附加 5 份授权证据');
        return;
      }
      if (!ids.includes(id)) form.setValue('evidenceAssetIds', [...ids, id], { shouldDirty: true });
      setMessage('授权证据已关联，仅你和相关审核人员可见');
    } else {
      form.setValue(target === 'avatar' ? 'avatarAssetId' : 'coverAssetId', id, {
        shouldDirty: true,
      });
      setMessage(target === 'avatar' ? '头像已关联' : '封面已关联');
    }
  };
  return (
    <EditorSection
      title="素材库"
      id="persona-assets"
      step={step}
      description="静态 JPEG、PNG 或 WebP，处理后由本站托管，现有素材继续保留"
    >
      <MediaPolicyNotice policy={policy} />
      <Field>
        <FieldLabel htmlFor="content-image-file">上传作品图片</FieldLabel>
        <Input
          id="content-image-file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={upload.isPending || !settings?.uploadsEnabled}
          onChange={(event) => {
            pick('content', event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <FieldDescription>上传后选择用于 README、头像或封面</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="evidence-image-file">上传私有授权证据</FieldLabel>
        <Input
          id="evidence-image-file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={upload.isPending || !settings?.uploadsEnabled}
          onChange={(event) => {
            pick('evidence', event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <FieldDescription>证据与作品图片分开存储，发布时不会进入公开内容或导出包</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="remote-image-url">在线图片地址</FieldLabel>
        <Input
          id="remote-image-url"
          type="url"
          name="remote-image-url"
          autoComplete="off"
          placeholder="https://图片地址…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <FieldDescription>
          只支持公网 HTTPS，点击后导入托管快照，原站后续修改不会改变本站图片
        </FieldDescription>
        <Button
          type="button"
          variant="outline"
          disabled={
            remote.isPending || Boolean(jobId && !imported) || !settings?.remoteImportsEnabled
          }
          onClick={() => remote.mutate()}
        >
          导入在线图片
        </Button>
      </Field>
      {jobId && <ImportStatus id={jobId} done={importDone} />}
      <FormNotice error={upload.error?.message ?? remote.error?.message} message={message} />
      {query.isPending ? (
        <p role="status">正在读取素材…</p>
      ) : query.isError ? (
        <>
          <FormNotice error={query.error.message} />
          <Button type="button" onClick={() => void query.refetch()}>
            重试素材列表
          </Button>
        </>
      ) : personaAssets.length === 0 ? (
        <p className="text-sm text-muted-foreground">上传图片后，会出现在你的私有素材库</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {personaAssets.map((asset) => (
            <div key={asset.id} className="flex min-w-0 flex-col gap-3 rounded-xl border p-3">
              <Image
                src={'/api/v1/me/assets/' + asset.id}
                alt={asset.purpose === 'evidence' ? '私有授权证据' : '已上传作品素材'}
                width={asset.width}
                height={asset.height}
                unoptimized
                className="h-28 w-full rounded-lg bg-muted object-contain"
              />
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  {asset.purpose === 'evidence' ? '私有证据' : '作品图片'}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {asset.width} × {asset.height}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {asset.purpose === 'content' ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => attachImage(asset.id, 'readme')}
                    >
                      插入 README
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => attachImage(asset.id, 'avatar')}
                    >
                      设为头像
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => attachImage(asset.id, 'cover')}
                    >
                      设为封面
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => attachImage(asset.id, 'evidence')}
                  >
                    关联授权证据
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => form.setValue('avatarAssetId', undefined, { shouldDirty: true })}
        >
          移除头像引用
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => form.setValue('coverAssetId', undefined, { shouldDirty: true })}
        >
          移除封面引用
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => form.setValue('evidenceAssetIds', [], { shouldDirty: true })}
        >
          清除证据引用
        </Button>
      </div>
    </EditorSection>
  );
}
