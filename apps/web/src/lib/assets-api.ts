import {
  listOwnAssets,
  uploadOwnImage,
  importOwnImageUrl,
  getOwnImageImportJob,
} from '@personamarket/api-client';
import {
  AssetListResponseSchema,
  AssetResponseSchema,
  AssetJobResponseSchema,
} from '@personamarket/contracts';
import { checkedResponse, authenticatedWrite, sessionRequestOptions } from './auth-api';
const options = () => ({ ...sessionRequestOptions, signal: AbortSignal.timeout(15000) });
export const assetsApi = {
  list: async () => checkedResponse(await listOwnAssets(options()), AssetListResponseSchema),
  upload: (file: File, purpose: 'content' | 'evidence') =>
    authenticatedWrite(
      (header) =>
        uploadOwnImage({
          ...options(),
          body: { file },
          params: { path: { purpose }, header },
          bodySerializer: (body) => {
            const form = new FormData();
            form.set('file', body.file);
            return form;
          },
        }),
      AssetResponseSchema,
    ),
  queue: (url: string) =>
    authenticatedWrite(
      (header) => importOwnImageUrl({ ...options(), body: { url }, params: { header } }),
      AssetJobResponseSchema,
    ),
  job: async (id: string) =>
    checkedResponse(
      await getOwnImageImportJob({ ...options(), params: { path: { id } } }),
      AssetJobResponseSchema,
    ),
};
