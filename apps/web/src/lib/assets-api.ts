import {
  listOwnAssets,
  uploadOwnImage,
  uploadPersonaAvatar,
  importOwnImageUrl,
  getOwnImageImportJob,
} from '@personamarket/api-client';
import {
  AssetListResponseSchema,
  AssetResponseSchema,
  AssetJobResponseSchema,
} from '@personamarket/contracts';
import { checkedResponse, authenticatedWriteFor, sessionRequestOptions } from './auth-api';
const options = () => ({ ...sessionRequestOptions, signal: AbortSignal.timeout(15000) });
export const assetsApi = {
  list: async () => checkedResponse(await listOwnAssets(options()), AssetListResponseSchema),
  uploadAvatar: (accountId: string, file: File) =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        uploadPersonaAvatar({
          ...options(),
          signal: AbortSignal.timeout(60000),
          body: { file },
          params: { header: { ...header, 'X-Expected-Account': accountId } },
          bodySerializer: (body) => {
            const form = new FormData();
            form.set('file', body.file);
            return form;
          },
        }),
      AssetResponseSchema,
    ),
  upload: (accountId: string, file: File, purpose: 'content' | 'evidence') =>
    authenticatedWriteFor(
      accountId,
      (header) =>
        uploadOwnImage({
          ...options(),
          body: { file },
          params: { path: { purpose }, header: { ...header, 'X-Expected-Account': accountId } },
          bodySerializer: (body) => {
            const form = new FormData();
            form.set('file', body.file);
            return form;
          },
        }),
      AssetResponseSchema,
    ),
  queue: (accountId: string, url: string) =>
    authenticatedWriteFor(
      accountId,
      (header) => importOwnImageUrl({ ...options(), body: { url }, params: { header } }),
      AssetJobResponseSchema,
    ),
  job: async (id: string) =>
    checkedResponse(
      await getOwnImageImportJob({ ...options(), params: { path: { id } } }),
      AssetJobResponseSchema,
    ),
};
