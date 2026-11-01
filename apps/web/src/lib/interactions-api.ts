import {
  favoritePersona,
  unfavoritePersona,
  likePersona,
  unlikePersona,
  getOwnPersonaInteractions,
  getOwnFavorites,
} from '@personamarket/api-client';
import {
  FavoritesResponseSchema,
  OwnInteractionsResponseSchema,
  InteractionResponseSchema,
  type FavoritesQuery,
} from '@personamarket/contracts';
import {
  ApiError,
  authenticatedWriteFor,
  checkedResponse,
  sessionRequestOptions,
} from './auth-api';

export const interactionKey = (accountId: string) =>
  ['private', 'persona-interactions', accountId] as const;
export const favoritesKey = (accountId: string) => ['private', 'favorites', accountId] as const;
export const interactionsApi = {
  states: async (ids: string, signal: AbortSignal) =>
    checkedResponse(
      await getOwnPersonaInteractions({
        ...sessionRequestOptions,
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        params: { query: { ids } },
      }),
      OwnInteractionsResponseSchema,
    ),
  favorites: async (input: FavoritesQuery, signal: AbortSignal) => {
    const { platform, ...query } = input;
    return checkedResponse(
      await getOwnFavorites({
        ...sessionRequestOptions,
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        params: { query: { ...query, ...(platform ? { platform } : {}) } },
      }),
      FavoritesResponseSchema,
    );
  },
  set: (accountId: string, id: string, kind: 'like' | 'favorite', enabled: boolean) =>
    authenticatedWriteFor(
      accountId,
      (header) => {
        const send =
          kind === 'like'
            ? enabled
              ? likePersona
              : unlikePersona
            : enabled
              ? favoritePersona
              : unfavoritePersona;
        return send({
          ...sessionRequestOptions,
          signal: AbortSignal.timeout(10000),
          body: {},
          params: { path: { id }, header },
        });
      },
      InteractionResponseSchema,
      {
        accountChanged: '登录账号已变化，请重新确认点赞或收藏',
        verificationRequired: '请先完成登录验证，再继续互动',
      },
    ).catch((cause: unknown) => {
      if (cause instanceof ApiError) throw cause;
      throw new Error('互动暂时无法完成，请稍后重试', { cause });
    }),
};
