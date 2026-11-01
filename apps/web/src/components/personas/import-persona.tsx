'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  NativeImportFormatSchema,
  type ImportPreviewResponseSchema,
  NATIVE_IMPORT_MAX_BYTES,
  type ImportTextEncoding,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { Field, FieldLabel, FieldDescription } from '@personamarket/ui/components/field';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import { FormNotice } from '../auth/auth-fields';
import { publicTransferSettingsQuery } from '@/lib/transfer-settings-api';
import { importsApi } from '@/lib/imports-api';
import { EditorSection } from './editor-section';
import { usePrivateResult } from './use-private-result';
import { ImportEncodingField, ImportEncodingSummary } from './import-encoding';
import { ConfirmImport } from './confirm-import';
export function ImportPersona() {
  const policy = useQuery(publicTransferSettingsQuery);
  const guard = usePrivateResult();
  const [format, setFormat] = useState<z.infer<typeof NativeImportFormatSchema>>('maibot-toml');
  const [encoding, setEncoding] = useState<ImportTextEncoding>('auto');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<
    z.infer<typeof ImportPreviewResponseSchema>['data'] | null
  >(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const mutation = useMutation({
    mutationFn: async () => {
      const accountId = guard.accountId();
      if (!policy.data) throw new Error('请先重新读取导入设置');
      if (!policy.data.data.importFormats.includes(format))
        throw new Error('此格式已关闭，请选择其他格式');
      if (!file) throw new Error('请先选择原生文件');
      if (file.size > policy.data.data.maxImportFileKiB * 1024)
        throw new Error('文件超过当前导入大小限制');
      if (file.size > NATIVE_IMPORT_MAX_BYTES) throw new Error('原生文件不能超过 4 MiB');
      const abort = new AbortController();
      controller.current = abort;
      try {
        const result = await importsApi.previewFile(
          accountId,
          file,
          { format, encoding },
          abort.signal,
        );
        abort.signal.throwIfAborted();
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
      if (guard.accepts(accountId)) setPreview(result.data);
    },
    retry: false,
    gcTime: 0,
  });
  const cancelled = mutation.error instanceof DOMException && mutation.error.name === 'AbortError';
  return (
    <div className="flex flex-col gap-6">
      <EditorSection
        title="选择原生文件"
        description="选择已启用的平台格式，文件大小按站点当前限制校验"
      >
        <Field>
          <FieldLabel id="import-format-label">文件格式</FieldLabel>
          <ToggleGroup
            aria-labelledby="import-format-label"
            value={[format]}
            variant="selection"
            className="max-w-full flex-wrap justify-start"
            disabled={mutation.isPending}
            onValueChange={(values) => {
              const checked = NativeImportFormatSchema.safeParse(values[0]);
              if (checked.success) {
                setFormat(checked.data);
                mutation.reset();
                setPreview(null);
              }
            }}
          >
            <ToggleGroupItem
              value="maibot-toml"
              disabled={!policy.data?.data.importFormats.includes('maibot-toml')}
              className="h-auto min-h-11 max-w-full whitespace-normal"
            >
              MaiBot TOML
            </ToggleGroupItem>
            <ToggleGroupItem
              value="astrbot-json"
              disabled={!policy.data?.data.importFormats.includes('astrbot-json')}
              className="h-auto min-h-11 max-w-full whitespace-normal"
            >
              AstrBot JSON
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel htmlFor="native-file">原生人设文件</FieldLabel>
          <Input
            id="native-file"
            type="file"
            accept={format === 'maibot-toml' ? '.toml' : '.json'}
            disabled={mutation.isPending}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              mutation.reset();
              setPreview(null);
            }}
          />
          <FieldDescription>
            文件只用于有界解析，机器人账号、密钥、工具和运行权限不会导入
          </FieldDescription>
        </Field>
        <ImportEncodingField
          id="native-import-encoding"
          value={encoding}
          disabled={mutation.isPending}
          onChange={(value) => {
            setEncoding(value);
            mutation.reset();
            setPreview(null);
          }}
        />
        <FormNotice error={cancelled ? null : mutation.error} />
        {cancelled && (
          <p role="status" className="text-sm text-muted-foreground">
            已取消解析，当前文件仍保留
          </p>
        )}
        <Button
          type="button"
          disabled={mutation.isPending || !file}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? '正在解析…' : '预览导入内容'}
        </Button>
        {mutation.isPending && (
          <Button type="button" variant="outline" onClick={() => controller.current?.abort()}>
            取消解析
          </Button>
        )}
      </EditorSection>
      {preview && (
        <>
          <EditorSection
            title="内容预览"
            description={
              preview.persona.platform === 'maibot'
                ? 'MaiBot 三个独立字段'
                : 'AstrBot 人格与成对对话'
            }
          >
            <ImportEncodingSummary value={preview.sourceEncoding} />
            <Alert role="note">
              <AlertTitle>导入提示</AlertTitle>
              <AlertDescription>
                <ul className="flex list-disc flex-col gap-2 pl-5 leading-6">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
            {preview.ignoredFields.length > 0 && (
              <p className="break-words text-sm leading-6 text-muted-foreground">
                已忽略配置字段：{preview.ignoredFields.join('、')}
              </p>
            )}
            {preview.persona.platform === 'maibot' ? (
              <div className="grid gap-4 lg:grid-cols-3">
                {[
                  ['人格设定', preview.persona.content.personality],
                  ['表达风格', preview.persona.content.replyStyle],
                  ['行为风格', preview.persona.content.behaviorStyle],
                ].map(([title, text]) => (
                  <section key={title} className="rounded-xl border p-4">
                    <h2 className="mb-3 font-semibold">{title}</h2>
                    <p className="whitespace-pre-wrap break-words text-sm leading-7">{text}</p>
                  </section>
                ))}
              </div>
            ) : (
              <>
                <p className="whitespace-pre-wrap break-words rounded-xl border p-4 text-sm leading-7">
                  {preview.persona.content.systemPrompt}
                </p>
                {preview.persona.content.dialoguePairs.map((pair, index) => (
                  <div key={pair.id} className="rounded-xl border p-4 text-sm leading-7">
                    <h2 className="mb-2 font-medium">预设对话 {index + 1}</h2>
                    <p className="whitespace-pre-wrap break-words">用户：{pair.user}</p>
                    <p className="whitespace-pre-wrap break-words">AI：{pair.assistant}</p>
                  </div>
                ))}
              </>
            )}
          </EditorSection>
          <ConfirmImport key={preview.id} preview={preview} />
        </>
      )}
    </div>
  );
}
