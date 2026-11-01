'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BracesIcon,
  ArchiveIcon,
  DownloadIcon,
  FileCode2Icon,
  FileTextIcon,
  LoaderCircleIcon,
  type LucideIcon,
} from 'lucide-react';
import { ExportFormatSchema, type ExportFormat, type Platform } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Field, FieldLabel } from '@personamarket/ui/components/field';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { Textarea } from '@personamarket/ui/components/textarea';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import { FormNotice } from '@/components/auth/auth-fields';
import { publicTransferSettingsQuery } from '@/lib/transfer-settings-api';
import { authQuery } from '@/lib/auth-api';
import { releasesApi } from '@/lib/releases-api';

export function ExportPersonaButton({
  scope,
  platform,
}: {
  scope: { id: string; releaseId: string };
  platform: Platform;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [preferredFormat, setFormat] = useState<ExportFormat>(
    platform === 'maibot' ? 'maibot-toml' : 'astrbot-json',
  );
  const [downloadNotice, setDownloadNotice] = useState<{
    tone: 'error' | 'neutral';
    text: string;
  } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const downloadAbort = useRef<AbortController | null>(null);
  useEffect(() => () => downloadAbort.current?.abort(), []);
  const formats: { value: ExportFormat; label: string; description: string; icon: LucideIcon }[] = [
    {
      value: platform === 'maibot' ? 'maibot-toml' : 'astrbot-json',
      label: platform === 'maibot' ? 'MaiBot TOML 片段' : 'AstrBot 原生 JSON',
      description:
        platform === 'maibot' ? '三个人格字段，按目标配置合并' : '目标平台原生人格与对话结构',
      icon: FileCode2Icon,
    },
    { value: 'text', label: '可读文本', description: '阅读与复制平台正文', icon: FileTextIcon },
    {
      value: 'markdown',
      label: 'Markdown',
      description: '分段标题与正文，适合文档阅读',
      icon: FileTextIcon,
    },
    {
      value: 'market-json',
      label: '通用 JSON',
      description: '保留作品资料、来源和图片引用',
      icon: BracesIcon,
    },
    {
      value: 'market-zip',
      label: '完整 ZIP 包',
      description: '作品资料与本版本图片，适合离线迁移',
      icon: ArchiveIcon,
    },
  ];
  const policy = useQuery({ ...publicTransferSettingsQuery, enabled: open });
  const auth = useQuery({ ...authQuery, enabled: open });
  const allowed = formats.filter((option) =>
    policy.data?.data.exportFormats.includes(option.value),
  );
  const format = allowed.some((option) => option.value === preferredFormat)
    ? preferredFormat
    : (allowed[0]?.value ?? preferredFormat);
  const authorized =
    policy.data?.data.guestExportsEnabled ||
    (auth.data?.data.account && auth.data.data.assurance === 'authenticated');
  const preview = useQuery({
    queryKey: [
      'public',
      'export-preview',
      scope.id,
      scope.releaseId,
      format,
      policy.data?.meta.revision,
      auth.data?.data.account?.id ?? null,
    ],
    queryFn: () => releasesApi.exportPreview(scope.id, scope.releaseId, format),
    enabled: open && Boolean(authorized) && allowed.length > 0,
    retry: false,
    gcTime: 0,
  });
  const data = preview.data?.data;
  const ready =
    Boolean(authorized) &&
    allowed.length > 0 &&
    !preview.isPending &&
    !preview.isError &&
    data?.format === format;
  const load = (next: ExportFormat) => {
    setFormat(next);
    setDownloadNotice(null);
  };
  const download = async () => {
    if (!ready || !data || data.format !== format || downloadAbort.current) return;
    const controller = new AbortController();
    downloadAbort.current = controller;
    const filename = data.filename;
    const selected = format;
    setDownloading(true);
    setDownloadNotice(null);
    try {
      const blob = await releasesApi.download(
        scope.id,
        scope.releaseId,
        selected,
        controller.signal,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setDownloadNotice(
        controller.signal.aborted
          ? { tone: 'neutral', text: '下载已取消，可重新尝试' }
          : { tone: 'error', text: error instanceof Error ? error.message : '下载失败，请重试' },
      );
    } finally {
      downloadAbort.current = null;
      setDownloading(false);
    }
  };
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true);
          load(format);
        }}
      >
        <DownloadIcon aria-hidden />
        导出
      </Button>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) downloadAbort.current?.abort();
          setOpen(next);
        }}
      >
        <SheetContent className="flex h-dvh max-h-dvh flex-col overflow-hidden sm:max-w-xl">
          <SheetHeader className="shrink-0 border-b pt-[max(1.25rem,env(safe-area-inset-top))]">
            <SheetTitle>导出这个版本</SheetTitle>
            <SheetDescription>选择适合的文件格式，预览与下载均对应当前公开版本</SheetDescription>
          </SheetHeader>
          <div className="@container/export flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-5">
            {(policy.isPending || auth.isPending) && <p role="status">正在读取导出设置…</p>}
            <FormNotice error={policy.error ?? auth.error} />
            {(policy.isError || auth.isError) && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void policy.refetch();
                  void auth.refetch();
                }}
              >
                重新读取导出设置
              </Button>
            )}
            {policy.data && !authorized && !auth.isPending && (
              <p role="status">本站要求登录后导出，请完成登录后重新打开此面板</p>
            )}
            {policy.data && allowed.length === 0 && (
              <p role="status">管理员已关闭适用于此人设的导出格式</p>
            )}
            <ToggleGroup
              aria-label="导出格式"
              variant="selection"
              className="grid w-full grid-cols-1 items-stretch gap-2 @min-[18rem]/export:grid-cols-2"
              value={[format]}
              onValueChange={(values) => {
                const next = ExportFormatSchema.safeParse(values[0]);
                if (next.success) load(next.data);
              }}
            >
              {allowed.map((option) => {
                const Icon = option.icon;
                return (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    disabled={downloading}
                    aria-label={option.label}
                    aria-describedby={uid + option.value}
                    className={
                      'h-full min-h-28 min-w-0 flex-col items-start justify-start gap-2 whitespace-normal rounded-xl border px-3 py-3 text-left' +
                      (option.value === 'market-zip' ? ' @min-[18rem]/export:col-span-2' : '')
                    }
                  >
                    <Icon className="size-4" aria-hidden />
                    <span className="text-sm font-semibold leading-5">{option.label}</span>
                    <span id={uid + option.value} className="text-sm font-normal leading-5">
                      {option.description}
                    </span>
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            <FormNotice error={preview.error} />
            {preview.isError && (
              <Button type="button" variant="outline" onClick={() => void preview.refetch()}>
                重新生成预览
              </Button>
            )}
            {preview.isFetching ? (
              <div role="status" className="space-y-3">
                <p className="text-sm text-muted-foreground">正在生成文件预览…</p>
                <Skeleton className="h-56 w-full" />
              </div>
            ) : data?.format === format && !preview.isError ? (
              <>
                {data.warnings.length > 0 && (
                  <div className="space-y-2">
                    {data.warnings.map((warning) => (
                      <p
                        key={warning}
                        className="rounded-xl border bg-accent/50 p-3 text-sm leading-6"
                      >
                        {warning}
                      </p>
                    ))}
                  </div>
                )}
                <p className="text-sm leading-6 text-muted-foreground">
                  此格式省略：{data.omittedFields.join('、')}
                </p>
                <Field>
                  <FieldLabel htmlFor={uid + '-preview'}>
                    {format === 'market-zip' ? '归档清单预览' : '导出内容预览'}
                  </FieldLabel>
                  <Textarea
                    id={uid + '-preview'}
                    value={data.text}
                    readOnly
                    className="min-h-56 resize-y font-mono text-sm leading-6"
                  />
                </Field>
              </>
            ) : null}
          </div>
          <div className="shrink-0 space-y-3 border-t bg-card px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {downloadNotice && (
              <p
                role={downloadNotice.tone === 'error' ? 'alert' : 'status'}
                className={
                  'text-sm leading-6 ' +
                  (downloadNotice.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')
                }
              >
                {downloadNotice.text}
              </p>
            )}
            <p className="break-all text-sm leading-5 text-muted-foreground">
              {data?.format === format
                ? data.filename
                : preview.isPending
                  ? '正在生成文件预览…'
                  : '文件预览就绪后可下载'}
            </p>
            <Button
              type="button"
              className="w-full"
              disabled={!ready || downloading}
              onClick={() => void download()}
            >
              {downloading ? (
                <LoaderCircleIcon className="motion-safe:animate-spin" aria-hidden />
              ) : (
                <DownloadIcon aria-hidden />
              )}
              {downloading ? '正在下载…' : '下载文件'}
            </Button>
            {downloading && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => downloadAbort.current?.abort()}
              >
                取消下载
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
