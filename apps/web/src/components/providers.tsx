'use client';
import { useCallback, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthSessionSync } from './auth/auth-session-sync';
import { CommentDraftProvider } from './comments/comment-drafts';
import { CreationDraftProvider } from './personas/creation-drafts';

export function Providers({ children }: { children: React.ReactNode }) {
  const [identityEpoch, setIdentityEpoch] = useState(0);
  const identityChanged = useCallback(() => setIdentityEpoch((epoch) => epoch + 1), []);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <AuthSessionSync onIdentityChange={identityChanged} />
      <CommentDraftProvider key={identityEpoch}>
        <CreationDraftProvider>{children}</CreationDraftProvider>
      </CommentDraftProvider>
    </QueryClientProvider>
  );
}
