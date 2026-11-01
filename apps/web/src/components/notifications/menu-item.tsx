'use client';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@personamarket/ui/components/badge';
import { notificationsApi, notificationsKey } from '@/lib/notifications-api';
export function NotificationUnreadCount({ accountId }: { accountId: string }) {
  const query = useQuery({
    queryKey: [...notificationsKey(accountId), 'count'],
    queryFn: ({ signal }) => notificationsApi.count(accountId, signal),
    retry: false,
    staleTime: 30000,
    refetchInterval: 60000,
  });
  return (
    <Badge
      id={'notification-count-' + accountId}
      variant="secondary"
      aria-live="polite"
      className="ml-auto shrink-0 tabular-nums"
    >
      {query.data ? `${query.data.data.unreadCount} 未读` : query.isError ? '待刷新' : '读取中…'}
    </Badge>
  );
}
