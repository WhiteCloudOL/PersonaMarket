'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  IMPORT_TEXT_MAX_BYTES,
  PlatformSchema,
  TextImportFormatSchema,
  TextMappedPreviewRequestSchema,
  type ImportTextEncoding,
  type TextImportSourceResponseSchema,
  type ImportPreviewResponseSchema,
  type MappedPersonaContentSchema,
  type Platform,
} from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Textarea } from '@personamarket/ui/components/textarea';
import { Field, FieldLabel, FieldDescription } from '@personamarket/ui/components/field';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@personamarket/ui/components/alert-dialog';
import { publicTransferSettingsQuery } from '@/lib/transfer-settings-api';
import { importsApi } from '@/lib/imports-api';
import { originalTextSelection } from '@/lib/import-text-selection';
import { FormNotice } from '../auth/auth-fields';
import { EditorSection } from './editor-section';
import { ImportEncodingField, ImportEncodingSummary } from './import-encoding';
import { ConfirmImport, type ImportConfirmationDetails } from './confirm-import';
import { ManualImportMapping, type TextScope } from './manual-import-mapping';
import { usePrivateResult } from './use-private-result';
import { useUnsavedDraft } from './use-unsaved-draft';

type Source = z.infer<typeof TextImportSourceResponseSchema>['data'];
type Preview = z.infer<typeof ImportPreviewResponseSchema>['data'];
type Mapped = z.infer<typeof MappedPersonaContentSchema>;

export function ManualImport() {
  const policy = useQuery(publicTransferSettingsQuery);
  const id = useId();
  const guard = usePrivateResult();
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<z.infer<typeof TextImportFormatSchema>>('text-plain');
  const [encoding, setEncoding] = useState<ImportTextEncoding>('auto');
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapped, setMapped] = useState<Mapped | undefined>();
  const [details, setDetails] = useState<ImportConfirmationDetails | undefined>();
  const [changing, setChanging] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const selection = useRef('');
  const controller = useRef<AbortController | null>(null);
  const workspace = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!source) return;
    workspace.current?.focus({ preventScroll: true });
    workspace.current?.scrollIntoView({ block: 'start' });
  }, [source, preview]);
  useUnsavedDraft(Boolean(file || source || preview) && !completed);

  const read = useMutation({
    mutationFn: async () => {
      const accountId = guard.accountId();
      if (!policy.data) throw new Error('请先重新读取导入设置');
      if (!policy.data.data.importFormats.includes(format))
        throw new Error('此格式已关闭，请选择其他格式');
      if (file && file.size > policy.data.data.maxImportFileKiB * 1024)
        throw new Error('文件超过当前导入大小限制');
      if (!file || !platform) throw new Error('请先选择文件和目标平台');
      if (!file.size || file.size > IMPORT_TEXT_MAX_BYTES)
        throw new Error('请选择非空且不超过 4 MiB 的文本文件');
      const abort = new AbortController();
      controller.current = abort;
      try {
        const result = await importsApi.textSource(
          accountId,
          file,
          { format, encoding },
          abort.signal,
        );
        abort.signal.throwIfAborted();
        return { result, accountId };
      } finally {
        if (controller.current === abort) controller.current = null;
      }
    },
    onSuccess: ({ result, accountId }) => {
      if (guard.accepts(accountId)) setSource(result.data);
    },
    retry: false,
    gcTime: 0,
  });
  const prepare = useMutation({
    mutationFn: async (persona: Mapped) => {
      const accountId = guard.accountId();
      if (!source) throw new Error('请先读取文本原文');
      const checked = TextMappedPreviewRequestSchema.safeParse({
        format: source.format,
        filename: source.filename,
        persona,
        mapped: true,
      });
      if (!checked.success)
        throw new Error(checked.error.issues[0]?.message ?? '请核对映射内容后重试');
      const abort = new AbortController();
      controller.current = abort;
      try {
        const result = await importsApi.textPreview(accountId, checked.data, abort.signal);
        abort.signal.throwIfAborted();
        return { result, accountId, persona };
      } finally {
        if (controller.current === abort) controller.current = null;
      }
    },
    onSuccess: ({ result, accountId, persona }) => {
      if (guard.accepts(accountId)) {
        setMapped(persona);
        setPreview(result.data);
      }
    },
    retry: false,
    gcTime: 0,
  });
  const readText = (scope: TextScope) => {
    const text = scope === 'all' ? source?.text : selection.current;
    if (!text) {
      setSelectionError('请先在原文中选中完整文本，再点击对应字段的填入按钮');
      return null;
    }
    setSelectionError(null);
    return text;
  };
  const resetSource = () => {
    setSource(null);
    setPreview(null);
    setMapped(undefined);
    selection.current = '';
    setSelectionError(null);
    read.reset();
    prepare.reset();
    setChanging(false);
  };
  const pending = read.isPending || prepare.isPending;
  const readCancelled = read.error instanceof DOMException && read.error.name === 'AbortError';
  const previewCancelled =
    prepare.error instanceof DOMException && prepare.error.name === 'AbortError';
  return (
    <div
      ref={workspace}
      tabIndex={-1}
      role="region"
      aria-label="文本导入工作区"
      className="flex min-w-0 scroll-mt-28 flex-col gap-6"
    >
      {!source ? (
        <EditorSection
          title="选择文本文件"
          description="TXT / Markdown 最大 4 MiB，读取后由你逐项选择正文，不自动拆分或执行文件内容"
          step="1"
        >
          <Field>
            <FieldLabel id={id + '-format'}>文本格式</FieldLabel>
            <ToggleGroup
              value={[format]}
              variant="selection"
              disabled={pending}
              aria-labelledby={id + '-format'}
              className="max-w-full flex-wrap justify-start"
              onValueChange={(values) => {
                const next = TextImportFormatSchema.safeParse(values[0]);
                if (next.success) {
                  setFormat(next.data);
                  read.reset();
                }
              }}
            >
              <ToggleGroupItem
                disabled={!policy.data?.data.importFormats.includes('text-plain')}
                value="text-plain"
                className="h-auto min-h-11 whitespace-normal"
              >
                TXT 纯文本
              </ToggleGroupItem>
              <ToggleGroupItem
                disabled={!policy.data?.data.importFormats.includes('text-markdown')}
                value="text-markdown"
                className="h-auto min-h-11 whitespace-normal"
              >
                Markdown
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor={id + '-file'}>TXT / Markdown 文件</FieldLabel>
            <Input
              id={id + '-file'}
              type="file"
              accept=".txt,.md,.markdown"
              disabled={pending}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                read.reset();
              }}
            />
            {file && <FieldDescription className="break-all">已选择：{file.name}</FieldDescription>}
          </Field>
          <ImportEncodingField
            id={id + '-encoding'}
            value={encoding}
            disabled={pending}
            onChange={(value) => {
              setEncoding(value);
              read.reset();
            }}
          />
          <Field>
            <FieldLabel id={id + '-platform'}>目标平台</FieldLabel>
            <ToggleGroup
              value={platform ? [platform] : []}
              variant="selection"
              disabled={pending}
              aria-labelledby={id + '-platform'}
              className="max-w-full flex-wrap justify-start"
              onValueChange={(values) => {
                const next = PlatformSchema.safeParse(values[0]);
                if (next.success) {
                  setPlatform(next.data);
                  read.reset();
                }
              }}
            >
              <ToggleGroupItem value="maibot" className="h-auto min-h-11 whitespace-normal">
                MaiBot 三项正文
              </ToggleGroupItem>
              <ToggleGroupItem value="astrbot" className="h-auto min-h-11 whitespace-normal">
                AstrBot 人格与对话
              </ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>
              请选择要使用的平台，正文由你手动映射，导入后平台固定
            </FieldDescription>
          </Field>
          <FormNotice
            error={readCancelled ? null : read.error}
            message={readCancelled ? '已取消读取，当前文件仍保留' : undefined}
          />
          <Button
            type="button"
            disabled={pending || !file || !platform}
            onClick={() => read.mutate()}
          >
            {read.isPending ? '正在读取…' : '读取文本原文'}
          </Button>
          {read.isPending && (
            <Button type="button" variant="outline" onClick={() => controller.current?.abort()}>
              取消读取
            </Button>
          )}
        </EditorSection>
      ) : (
        <>
          <EditorSection title="核对原文与平台" description={source.filename} step="1">
            <ImportEncodingSummary value={source.sourceEncoding} />
            <p className="text-sm leading-6">
              目标平台：{platform === 'maibot' ? 'MaiBot' : 'AstrBot'}
            </p>
            {source.warnings.length > 0 && (
              <Alert role="note">
                <AlertTitle>编码提示</AlertTitle>
                <AlertDescription>{source.warnings.join('；')}</AlertDescription>
              </Alert>
            )}
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal py-2"
              disabled={pending}
              onClick={() => setChanging(true)}
            >
              更换文件、编码或平台
            </Button>
          </EditorSection>
          {!preview && platform && (
            <div className="grid min-w-0 items-start gap-6 xl:grid-cols-2">
              <EditorSection
                title="原文"
                description="用鼠标、触控或键盘选择完整段落，再点击目标字段的填入按钮；也可直接粘贴或编辑字段"
                step="2"
              >
                <Field>
                  <FieldLabel htmlFor={id + '-source'}>文本原文（只读）</FieldLabel>
                  <Textarea
                    id={id + '-source'}
                    defaultValue={source.text}
                    readOnly
                    spellCheck={false}
                    aria-describedby={id + '-selection-help'}
                    className="h-80 min-h-60 field-sizing-fixed md:h-[32rem]"
                    onSelect={(event) => {
                      selection.current = originalTextSelection(
                        source.text,
                        event.currentTarget.selectionStart,
                        event.currentTarget.selectionEnd,
                      );
                    }}
                  />
                  <FieldDescription id={id + '-selection-help'}>
                    键盘可用 Shift + 方向键选中，全文填入会保留原文的空白与换行；Markdown
                    按纯文本处理
                  </FieldDescription>
                </Field>
                <FormNotice error={selectionError} />
              </EditorSection>
              <EditorSection
                title="字段映射"
                description={
                  platform === 'maibot'
                    ? '独立填写人格设定、表达风格和行为风格'
                    : '填写系统提示词，并按需要添加成对的预设对话'
                }
                step="3"
              >
                <ManualImportMapping
                  platform={platform}
                  initialValues={mapped}
                  readText={readText}
                  pending={prepare.isPending}
                  error={previewCancelled ? null : prepare.error}
                  onCancel={() => controller.current?.abort()}
                  onPreview={(values) => prepare.mutate(values)}
                />
                {previewCancelled && (
                  <p role="status" className="text-sm text-muted-foreground">
                    已取消预览，映射内容仍保留
                  </p>
                )}
              </EditorSection>
            </div>
          )}
          {preview && (
            <>
              <EditorSection
                title="映射已生成预览"
                description="本次只导入已确认的字段，名称与来源说明在下一步填写"
                step="3"
              >
                <p className="text-sm leading-6">
                  已核对{' '}
                  {preview.persona.platform === 'maibot'
                    ? 'MaiBot 三项正文'
                    : `AstrBot 系统提示词和 ${preview.persona.content.dialoguePairs.length} 组成对对话`}
                </p>
                {preview.persona.platform === 'maibot' ? (
                  <>
                    <MappedPreviewField
                      label="人格设定"
                      text={preview.persona.content.personality}
                    />
                    <MappedPreviewField
                      label="表达风格"
                      text={preview.persona.content.replyStyle}
                    />
                    <MappedPreviewField
                      label="行为风格"
                      text={preview.persona.content.behaviorStyle}
                    />
                  </>
                ) : (
                  <>
                    <MappedPreviewField
                      label="系统提示词"
                      text={preview.persona.content.systemPrompt}
                    />
                    {preview.persona.content.dialoguePairs.map((pair, index) => (
                      <section
                        key={pair.id}
                        className="flex min-w-0 flex-col gap-4 rounded-xl border p-4"
                        aria-label={'预览对话 ' + (index + 1)}
                      >
                        <MappedPreviewField label={'用户消息 ' + (index + 1)} text={pair.user} />
                        <MappedPreviewField
                          label={'AI 回复 ' + (index + 1)}
                          text={pair.assistant}
                        />
                      </section>
                    ))}
                  </>
                )}
                <Alert role="note">
                  <AlertTitle>导入提示</AlertTitle>
                  <AlertDescription>{preview.warnings.join('；')}</AlertDescription>
                </Alert>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 max-w-full whitespace-normal py-2"
                  onClick={() => {
                    setPreview(null);
                    prepare.reset();
                  }}
                >
                  返回修改字段映射
                </Button>
              </EditorSection>
              <ConfirmImport
                key={preview.id}
                preview={preview}
                details={details}
                onDetailsChange={setDetails}
                onComplete={() => setCompleted(true)}
              />
            </>
          )}
        </>
      )}
      <AlertDialog open={changing} onOpenChange={setChanging}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新读取文本文件？</AlertDialogTitle>
            <AlertDialogDescription>
              当前字段映射和预览将清除，名称与来源说明继续保留；取消可返回继续编辑
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>保留当前映射</AlertDialogCancel>
            <AlertDialogAction
              className="h-auto min-h-11 max-w-full whitespace-normal py-2"
              onClick={resetSource}
            >
              清除映射并重新读取
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MappedPreviewField({ label, text }: { label: string; text: string }) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>预览：{label}</FieldLabel>
      <Textarea id={id} value={text} readOnly className="h-32 field-sizing-fixed" />
    </Field>
  );
}
