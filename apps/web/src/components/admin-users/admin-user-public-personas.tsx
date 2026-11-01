'use client';
import { useQuery } from '@tanstack/react-query';
import { AdminUserContentQuerySchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Skeleton } from '@personamarket/ui/components/skeleton';
import { adminUsersApi, adminUsersKey } from '@/lib/admin-users-api';
import { FormNotice } from '../auth/auth-fields';
import { PublicCards } from '../personas/public-cards';
import { useUserContentLocation, UserContentPagination } from './admin-user-content-navigation';

export function AdminUserPublicPersonas({ accountId, id }: { accountId: string; id: string }) {
  const { search, update } = useUserContentLocation();
  const parsed = AdminUserContentQuerySchema.safeParse({
    page: search.get('publicPage') ?? 1,
    pageSize: 20,
  });
  const input = parsed.success ? parsed.data : undefined;
  const query = useQuery({
    queryKey: [
      ...adminUsersKey(accountId),
      'public-personas',
      id,
      input ?? search.get('publicPage'),
    ],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('作品页码无效');
      return adminUsersApi.publicPersonas(accountId, id, input, signal);
    },
    enabled: Boolean(input),
    retry: false,
  });
  return (
    <section aria-label="用户公开作品" className="flex min-w-0 flex-col gap-4">
      <h2 className="text-lg font-semibold">当前公开作品</h2>
      <p className="text-sm text-muted-foreground">
        按账号归属读取当前公开版本，隐藏或下架的作品不列入此处
      </p>
      {!input ? (
        <>
          <FormNotice error="作品页码无效，请返回第一页" />
          <Button variant="outline" onClick={() => update({ publicPage: null })}>
            返回作品第一页
          </Button>
        </>
      ) : (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isError ? '重试公开作品' : query.isFetching ? '正在读取…' : '刷新公开作品'}
          </Button>
          <FormNotice error={query.error} />
          {query.isPending && (
            <>
              <p role="status">正在读取公开作品…</p>
              <Skeleton className="h-48 w-full" />
            </>
          )}
          {query.data && (
            <>
              <p className="text-sm text-muted-foreground">
                共 {query.data.meta.total} 个当前公开作品
              </p>
              {query.data.data.length ? (
                <PublicCards items={query.data.data} layout="list" />
              ) : (
                <p className="rounded-xl border p-5 text-muted-foreground">
                  这位用户还没有当前公开的作品
                </p>
              )}
              <UserContentPagination
                page={input.page}
                total={query.data.meta.total}
                pending={query.isFetching}
                label="用户公开作品分页"
                onPageChange={(page) => update({ publicPage: page === 1 ? null : String(page) })}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
