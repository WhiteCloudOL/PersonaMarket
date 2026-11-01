import {
  previewNativePersonaImport,
  previewNativePersonaFile,
  confirmNativePersonaImport,
  readPersonaTextFile,
  previewMappedPersonaImport,
} from '@personamarket/api-client';
import {
  ImportPreviewResponseSchema,
  DraftResponseSchema,
  type ImportPreviewRequestSchema,
  type ImportConfirmRequestSchema,
  type NativeImportFileQuerySchema,
  type TextImportFileQuerySchema,
  type TextMappedPreviewRequestSchema,
  TextImportSourceResponseSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import {
  authenticatedWrite,
  authenticatedWriteFor,
  sessionRequestOptions,
  ApiError,
} from './auth-api';
async function network<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof ApiError || (cause instanceof DOMException && cause.name === 'AbortError'))
      throw cause;
    throw new Error('请求未完成，请检查连接后重试', { cause });
  }
}
export const importsApi = {
  textSource: (
    accountId: string,
    file: File,
    query: z.infer<typeof TextImportFileQuerySchema>,
    signal: AbortSignal,
  ) =>
    network(() =>
      authenticatedWriteFor(
        accountId,
        (header) =>
          readPersonaTextFile({
            ...sessionRequestOptions,
            signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
            body: { file },
            params: { header, query },
            bodySerializer: (body) => {
              const form = new FormData();
              form.set('file', body.file);
              return form;
            },
          }),
        TextImportSourceResponseSchema,
      ),
    ),
  textPreview: (
    accountId: string,
    body: z.infer<typeof TextMappedPreviewRequestSchema>,
    signal: AbortSignal,
  ) =>
    network(() =>
      authenticatedWriteFor(
        accountId,
        (header) =>
          previewMappedPersonaImport({
            ...sessionRequestOptions,
            signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
            body,
            params: { header },
          }),
        ImportPreviewResponseSchema,
      ),
    ),
  previewFile: (
    accountId: string,
    file: File,
    query: z.infer<typeof NativeImportFileQuerySchema>,
    signal: AbortSignal,
  ) =>
    network(() =>
      authenticatedWriteFor(
        accountId,
        (header) =>
          previewNativePersonaFile({
            ...sessionRequestOptions,
            signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
            body: { file },
            params: { header, query },
            bodySerializer: (body) => {
              const form = new FormData();
              form.set('file', body.file);
              return form;
            },
          }),
        ImportPreviewResponseSchema,
      ),
    ),
  preview: (body: z.infer<typeof ImportPreviewRequestSchema>) =>
    authenticatedWrite(
      (header) =>
        previewNativePersonaImport({
          ...sessionRequestOptions,
          signal: AbortSignal.timeout(15000),
          body,
          params: { header },
        }),
      ImportPreviewResponseSchema,
    ),
  confirm: (accountId: string, body: z.infer<typeof ImportConfirmRequestSchema>) =>
    network(() =>
      authenticatedWriteFor(
        accountId,
        (header) =>
          confirmNativePersonaImport({
            ...sessionRequestOptions,
            signal: AbortSignal.timeout(15000),
            body,
            params: { header },
          }),
        DraftResponseSchema,
      ),
    ),
};
