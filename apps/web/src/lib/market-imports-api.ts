import * as api from '@personamarket/api-client';
import {
  MarketImportPreviewResponseSchema,
  MarketImportImageListResponseSchema,
  MarketImportDiscardResponseSchema,
  DraftResponseSchema,
  type MarketImportConfirmSchema,
  type ImportTextEncoding,
} from '@personamarket/contracts';
import type { z } from 'zod';
import {
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
  ApiError,
} from './auth-api';

const options = (signal?: AbortSignal, timeout = 15000) => ({
  ...sessionRequestOptions,
  signal: signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
    : AbortSignal.timeout(timeout),
});
const fileBody = (body: { file: File | Blob }) => {
  const form = new FormData();
  form.set('file', body.file);
  return form;
};
async function network<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof ApiError || (cause instanceof DOMException && cause.name === 'AbortError'))
      throw cause;
    throw new Error('请求未完成，请检查连接后重试', { cause });
  }
}
export const marketImportsApi = {
  preview: (accountId: string, file: File, signal: AbortSignal, encoding: ImportTextEncoding) =>
    network(() =>
      authenticatedWriteFor(
        accountId,
        (header) =>
          api.previewMarketPersonaImport({
            ...options(signal, 300000),
            body: { file },
            params: { header, query: { encoding } },
            bodySerializer: fileBody,
          }),
        MarketImportPreviewResponseSchema,
      ),
    ),
  images: (id: string, signal: AbortSignal) =>
    network(async () =>
      checkedResponse(
        await api.listMarketImportImages({ ...options(signal), params: { path: { id } } }),
        MarketImportImageListResponseSchema,
      ),
    ),
  queue: (accountId: string, id: string, assetId: string) =>
    network(() =>
      authenticatedWriteFor(
        accountId,
        (header) =>
          api.confirmMarketImportImageUrl({
            ...options(),
            params: { header, path: { id, assetId } },
          }),
        MarketImportImageListResponseSchema,
      ),
    ),
  upload: (accountId: string, id: string, assetId: string, file: File) =>
    network(() =>
      authenticatedWriteFor(
        accountId,
        (header) =>
          api.uploadMarketImportImage({
            ...options(),
            body: { file },
            params: { header, path: { id, assetId } },
            bodySerializer: fileBody,
          }),
        MarketImportImageListResponseSchema,
      ),
    ),
  discard: (accountId: string, id: string) =>
    network(() =>
      authenticatedWriteFor(
        accountId,
        (header) =>
          api.discardMarketPersonaImport({ ...options(), params: { header, path: { id } } }),
        MarketImportDiscardResponseSchema,
      ),
    ),
  confirm: (accountId: string, body: z.infer<typeof MarketImportConfirmSchema>) =>
    network(() =>
      authenticatedWriteFor(
        accountId,
        (header) =>
          api.confirmMarketPersonaImport({
            ...options(),
            body,
            params: { header },
          }),
        DraftResponseSchema,
      ),
    ),
};
