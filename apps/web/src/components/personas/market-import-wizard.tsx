'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArchiveIcon,
  BracesIcon,
  CheckIcon,
  FileUpIcon,
  LoaderCircleIcon,
  LockKeyholeIcon,
  ArrowLeftIcon,
} from 'lucide-react';
import {
  MARKET_ARCHIVE_MAX_BYTES,
  MARKET_DOCUMENT_MAX_BYTES,
  type MarketImportPreview,
  type ImportTextEncoding,
} from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Field, FieldLabel } from '@personamarket/ui/components/field';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { publicTransferSettingsQuery } from '@/lib/transfer-settings-api';
import { authQuery, ApiError } from '@/lib/auth-api';
import { marketImportsApi } from '@/lib/market-imports-api';
import { FormNotice } from '../auth/auth-fields';
import { EditorSection } from './editor-section';
import { MarketImportReview } from './market-import-review';
import { MarketImportConfirm } from './market-import-confirm';
import { usePrivateResult } from './use-private-result';
import { useUnsavedDraft } from './use-unsaved-draft';
import { ImportEncodingField } from './import-encoding';

const hydration = () => () => {};
export function MarketImportWizard() {
  const hydrated = useSyncExternalStore(
    hydration,
    () => true,
    () => false,
  );
  return hydrated ? <Wizard /> : <Skeleton className="h-96 w-full" aria-label="正在准备导入向导" />;
}
function Wizard() {
  const auth = useQuery(authQuery);
  const policy = useQuery(publicTransferSettingsQuery);
  const guard = usePrivateResult();
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState<ImportTextEncoding>('auto');
  const [preview, setPreview] = useState<MarketImportPreview | null>(null);
  const [step, setStep] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step > 0) {
      content.current?.focus({ preventScroll: true });
      content.current?.scrollIntoView({ block: 'start' });
    }
  }, [step]);
  useEffect(() => () => controller.current?.abort(), []);
  useUnsavedDraft(Boolean(file || preview) && !completed);
  const mutation = useMutation({
    mutationFn: async (selected: File) => {
      const accountId = guard.accountId();
      const abort = new AbortController();
      controller.current = abort;
      try {
        const head = await selected.slice(0, 4).arrayBuffer();
        const zip = head.byteLength === 4 && new DataView(head).getUint32(0, true) === 0x04034b50;
        if (!policy.data) throw new Error('请先重新读取导入设置');
        if (!policy.data.data.importFormats.includes(zip ? 'market-zip' : 'market-json'))
          throw new Error('此格式已关闭，请选择其他格式');
        if (
          selected.size >
          (zip
            ? policy.data.data.maxImportArchiveMiB * 1024 * 1024
            : policy.data.data.maxImportFileKiB * 1024)
        )
          throw new Error('文件超过当前导入大小限制');
        if (selected.size > (zip ? MARKET_ARCHIVE_MAX_BYTES : MARKET_DOCUMENT_MAX_BYTES))
          throw new Error(zip ? '完整ZIP包不能超过128 MiB' : '通用JSON不能超过4 MiB');
        const result = await marketImportsApi.preview(accountId, selected, abort.signal, encoding);
        return { result, accountId };
      } catch (cause) {
        if (abort.signal.aborted)
          throw new DOMException('已取消解析，当前文件仍保留', 'AbortError');
        throw cause;
      } finally {
        if (controller.current === abort) controller.current = null;
      }
    },
    onSuccess: ({ result, accountId }) => {
      if (!guard.accepts(accountId)) return;
      setPreview(result.data);
      setStep(1);
    },
    retry: false,
    gcTime: 0,
  });
  const discard = useMutation({
    mutationFn: async () => {
      const accountId = guard.accountId();
      if (preview) {
        try {
          await marketImportsApi.discard(accountId, preview.id);
        } catch (cause) {
          if (!(cause instanceof ApiError && cause.code === 'NOT_FOUND')) throw cause;
        }
      }
      return accountId;
    },
    onSuccess: (accountId) => {
      if (guard.accepts(accountId)) {
        setPreview(null);
        setFile(null);
        setStep(0);
        mutation.reset();
        setLocalError(null);
      }
    },
    retry: false,
    gcTime: 0,
  });
  const choose = (files: FileList | null) => {
    if (!files?.length) return;
    if (files.length !== 1) {
      setLocalError('每次请选择一个人设文件');
      return;
    }
    const selected = files[0];
    if (!selected) return;
    setFile(selected);
    setLocalError(null);
    mutation.reset();
  };
  const cancelled = mutation.error instanceof DOMException && mutation.error.name === 'AbortError';
  const signedIn = auth.data?.data.assurance === 'authenticated';
  const steps = ['选择文件', '核对内容', '保存草稿'];
  return (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div
        ref={content}
        role="region"
        aria-label="导入工作区"
        tabIndex={-1}
        className="min-w-0 scroll-mt-24 space-y-6 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ol aria-label="导入步骤" className="grid grid-cols-3 rounded-xl border bg-card p-2 sm:p-4">
          {steps.map((label, index) => (
            <li
              key={label}
              aria-current={step === index ? 'step' : undefined}
              className="flex min-w-0 flex-col items-center gap-2 px-1 py-2 text-center sm:flex-row sm:justify-center sm:gap-3"
            >
              <span
                className={
                  'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ' +
                  (step >= index
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground')
                }
              >
                {step > index ? <CheckIcon className="size-4" aria-hidden /> : index + 1}
              </span>
              <span
                className={
                  'text-sm sm:text-base ' +
                  (step === index ? 'font-semibold' : 'text-muted-foreground')
                }
              >
                {label}
              </span>
            </li>
          ))}
        </ol>
        {!signedIn && auth.data && (
          <div className="space-y-3 rounded-xl bg-accent/60 p-4 text-base leading-7">
            <p>在新窗口完成登录或验证后回来继续，当前文件与来源输入会保留</p>
            <Link
              target="_blank"
              rel="noopener noreferrer"
              href={auth.data.data.assurance === 'mfa_required' ? '/mfa' : '/login'}
              className={buttonVariants({
                variant: 'outline',
                className: 'h-auto min-h-11 max-w-full whitespace-normal',
              })}
            >
              在新窗口{auth.data.data.assurance === 'mfa_required' ? '完成验证' : '登录'}
            </Link>
          </div>
        )}
        {step === 0 && (
          <EditorSection
            title="把角色文件带到这里"
            description="识别通用JSON或完整ZIP，先预览，再确认保存"
          >
            <div
              className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed bg-muted/20 px-4 py-6 text-center sm:py-8"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (!mutation.isPending) choose(event.dataTransfer.files);
              }}
            >
              <div className="flex size-16 items-center justify-center rounded-2xl bg-accent text-primary">
                <FileUpIcon className="size-7" aria-hidden />
              </div>
              <div className="space-y-2">
                <p className="text-lg font-semibold">选择或拖入一个人设文件</p>
                <p className="text-sm leading-6 text-muted-foreground">
                  通用 JSON 最大4 MiB · 完整 ZIP 最大128 MiB
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => input.current?.click()}
              >
                选择人设文件
              </Button>
              <Field className="sr-only">
                <FieldLabel htmlFor="market-import-file">通用人设文件</FieldLabel>
                <Input
                  ref={input}
                  id="market-import-file"
                  type="file"
                  accept=".json,.zip"
                  tabIndex={-1}
                  disabled={mutation.isPending}
                  onChange={(event) => choose(event.target.files)}
                />
              </Field>
            </div>
            <ImportEncodingField
              id="market-import-encoding"
              value={encoding}
              disabled={mutation.isPending}
              onChange={(value) => {
                setEncoding(value);
                mutation.reset();
              }}
            />
            {file && (
              <div className="flex min-w-0 items-start gap-3 rounded-xl border p-4">
                <FileUpIcon className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <p className="break-all text-base font-medium">{file.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {(file.size / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} KiB ·
                    内容只用于本次导入
                  </p>
                </div>
              </div>
            )}
            <FormNotice error={localError || (cancelled ? null : mutation.error) || auth.error} />
            {cancelled && (
              <p role="status" className="text-sm text-muted-foreground">
                已取消解析，当前文件仍保留
              </p>
            )}
            {auth.isError && (
              <Button type="button" variant="outline" onClick={() => void auth.refetch()}>
                重试读取登录状态
              </Button>
            )}
            <Button
              type="button"
              className="h-auto min-h-11 whitespace-normal"
              disabled={!file || mutation.isPending || !signedIn}
              onClick={() => {
                if (file) mutation.mutate(file);
              }}
            >
              {mutation.isPending ? (
                <LoaderCircleIcon className="motion-safe:animate-spin" aria-hidden />
              ) : (
                <FileUpIcon aria-hidden />
              )}
              {mutation.isPending ? '正在校验文件与图片…' : '预览导入内容'}
            </Button>
            {mutation.isPending && (
              <Button type="button" variant="outline" onClick={() => controller.current?.abort()}>
                取消解析
              </Button>
            )}
          </EditorSection>
        )}
        {preview && (
          <>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
              <p className="min-w-0 flex-1 break-all text-sm font-medium">{preview.filename}</p>
              <Button
                type="button"
                variant="ghost"
                disabled={discard.isPending}
                onClick={() => discard.mutate()}
              >
                <ArrowLeftIcon aria-hidden />
                重新选择文件
              </Button>
            </div>
            <FormNotice error={discard.error} />
            <div hidden={step !== 1}>
              <MarketImportReview
                preview={preview}
                active={step === 1}
                onContinue={(images) => {
                  setPreview({ ...preview, images });
                  setStep(2);
                }}
              />
            </div>
            <div hidden={step !== 2}>
              <MarketImportConfirm
                key={preview.id}
                preview={preview}
                onBack={() => setStep(1)}
                onComplete={() => setCompleted(true)}
              />
            </div>
          </>
        )}
      </div>
      <aside className="min-w-0 space-y-4 lg:sticky lg:top-24" aria-label="导入格式说明">
        <div className="rounded-xl border bg-card p-5">
          <ArchiveIcon className="mb-3 size-6 text-primary" aria-hidden />
          <h2 className="font-semibold">完整 ZIP</h2>
          <p className="mt-2 text-base leading-7 text-muted-foreground">
            包含正文、作品资料、README和图片，适合离线迁移
          </p>
          <p className="mt-3 text-sm text-primary">图片较多时优先选择</p>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <BracesIcon className="mb-3 size-6 text-primary" aria-hidden />
          <h2 className="font-semibold">通用 JSON</h2>
          <p className="mt-2 text-base leading-7 text-muted-foreground">
            保留完整资料与源图片清单，图片需确认在线导入或补充原图
          </p>
        </div>
        <p className="flex items-start gap-2 px-1 text-sm leading-6 text-muted-foreground">
          <LockKeyholeIcon className="mt-1 size-4 shrink-0" aria-hidden />
          <span>确认后仅保存私有草稿，公开发布仍需创建版本和审核</span>
        </p>
      </aside>
    </div>
  );
}
