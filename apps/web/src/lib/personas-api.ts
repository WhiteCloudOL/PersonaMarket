import {
  createOwnPersona,
  getOwnPersonaDraft,
  saveOwnPersonaDraft,
  listOwnPersonas,
  getPersonaTaxonomy,
} from '@personamarket/api-client';
import {
  DraftResponseSchema,
  MyPersonasResponseSchema,
  TaxonomyResponseSchema,
  type PersonaDraft,
  type Platform,
} from '@personamarket/contracts';
import { checkedResponse, authenticatedWrite, sessionRequestOptions } from './auth-api';
const options = () => ({ ...sessionRequestOptions, signal: AbortSignal.timeout(10000) });
function draftBody(value: PersonaDraft) {
  const { avatarAssetId, coverAssetId, recommendedModels, origin, ...rest } = value;
  const { policyText, ...originFields } = origin;
  const source =
    originFields.type === 'repost'
      ? (() => {
          const { sourceUrl, sourceDescription, ...fields } = originFields;
          return {
            ...fields,
            ...(sourceUrl === undefined ? {} : { sourceUrl }),
            ...(sourceDescription === undefined ? {} : { sourceDescription }),
          };
        })()
      : originFields;
  return {
    ...rest,
    origin: { ...source, ...(policyText === undefined ? {} : { policyText }) },
    recommendedModels: recommendedModels.map(({ modelId, note }) => ({
      modelId,
      ...(note === undefined ? {} : { note }),
    })),
    ...(avatarAssetId === undefined ? {} : { avatarAssetId }),
    ...(coverAssetId === undefined ? {} : { coverAssetId }),
  };
}
export const personasApi = {
  createComplete: (draft: PersonaDraft) =>
    authenticatedWrite(
      (header) =>
        createOwnPersona({
          ...options(),
          body: { platform: draft.platform, title: draft.title, initialDraft: draftBody(draft) },
          params: { header },
        }),
      DraftResponseSchema,
    ),
  create: (platform: Platform, title: string) =>
    authenticatedWrite(
      (header) => createOwnPersona({ ...options(), body: { platform, title }, params: { header } }),
      DraftResponseSchema,
    ),
  read: async (id: string) =>
    checkedResponse(
      await getOwnPersonaDraft({ ...options(), params: { path: { id } } }),
      DraftResponseSchema,
    ),
  save: (id: string, body: PersonaDraft, revision: number) =>
    authenticatedWrite(
      (header) =>
        saveOwnPersonaDraft({
          ...options(),
          body: draftBody(body),
          params: { path: { id }, header: { ...header, 'If-Match': '"draft-' + revision + '"' } },
        }),
      DraftResponseSchema,
    ),
  list: async (page = 1) =>
    checkedResponse(
      await listOwnPersonas({ ...options(), params: { query: { page, pageSize: 20 } } }),
      MyPersonasResponseSchema,
    ),
  taxonomy: async () =>
    checkedResponse(await getPersonaTaxonomy(options()), TaxonomyResponseSchema),
};
