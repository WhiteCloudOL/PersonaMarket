'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthContextResponse } from '@personamarket/contracts';
import { assetsApi } from '@/lib/assets-api';
import { authQuery } from '@/lib/auth-api';
import { publicMediaSettingsQuery } from '@/lib/media-settings-api';

export const personaMediaUploadKey = ['private', 'persona-media-upload'] as const;
export const personaAssetsKey = ['private', 'assets'] as const;
export const imageAccept = 'image/png,image/jpeg,image/webp';

export function usePersonaMedia() {
  const session = useQuery(authQuery).data?.data;
  const accountId = session?.assurance === 'authenticated' ? session.account?.id : undefined;
  const policy = useQuery({ ...publicMediaSettingsQuery, enabled: Boolean(accountId) });
  const client = useQueryClient();
  const ownsSession = (id: string) => {
    const current = client.getQueryData<AuthContextResponse>(authQuery.queryKey)?.data;
    return current?.assurance === 'authenticated' && current.account?.id === id;
  };
  return { accountId, policy, client, ownsSession };
}

export function usePersonaImageUpload(
  purpose: 'content' | 'evidence',
  onUploaded: (id: string) => void,
) {
  const media = usePersonaMedia();
  const settings = media.policy.isError ? undefined : media.policy.data?.data;
  const upload = useMutation({
    mutationKey: personaMediaUploadKey,
    mutationFn: async (file: File) => {
      if (!media.accountId) throw new Error('请先登录');
      if (!settings?.uploadsEnabled) throw new Error('本地图片上传暂不可用');
      if (!file.size || file.size > settings.maxImageKiB * 1024)
        throw new Error(`请选择 ${settings.maxImageKiB} KiB 以内的有效图片`);
      return {
        ...(await assetsApi.upload(media.accountId, file, purpose)),
        accountId: media.accountId,
      };
    },
    onSuccess: ({ data, accountId }) => {
      if (!media.ownsSession(accountId)) return;
      onUploaded(data.id);
      void media.client.invalidateQueries({ queryKey: personaAssetsKey });
    },
    gcTime: 0,
    retry: false,
  });
  return { ...media, settings, upload };
}
