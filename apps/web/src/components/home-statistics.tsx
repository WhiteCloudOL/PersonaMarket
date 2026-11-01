'use client';
import { useQuery } from '@tanstack/react-query';
import { getPublicStatistics } from '@personamarket/api-client';
import { PublicStatisticsResponseSchema } from '@personamarket/contracts';
import type { z } from 'zod';
import { FormNotice } from './auth/auth-fields';

export function HomeStatistics({
  initialData,
}: {
  initialData: z.infer<typeof PublicStatisticsResponseSchema> | null;
}) {
  const query = useQuery({
    queryKey: ['public', 'statistics'],
    ...(initialData ? { initialData } : {}),
    staleTime: 30_000,
    retry: 1,
    retryDelay: 1000,
    refetchOnWindowFocus: (query) => (query.state.status === 'error' ? 'always' : false),
    refetchOnReconnect: (query) => (query.state.status === 'error' ? 'always' : true),
    queryFn: async ({ signal }) => {
      const result = await getPublicStatistics({
        cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      if (!result.response.ok) throw new Error('STATISTICS_UNAVAILABLE');
      return PublicStatisticsResponseSchema.parse(result.data);
    },
  });
  const labels = { personas: '公开人设', creators: '创作者', exports: '有效导出' } as const;
  return (
    <section aria-label="社区统计" className="flex w-full max-w-md flex-col gap-3 pt-1">
      <div className="flex min-w-0 items-center gap-3">
        {query.data ? (
          <dl
            aria-live="polite"
            aria-atomic="true"
            className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-x-4 gap-y-3"
          >
            {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
              <div
                key={key}
                className="flex min-w-0 flex-col-reverse gap-1 border-l border-border/70 pl-4 first:border-l-0 first:pl-0"
              >
                <dt className="text-sm text-muted-foreground">{labels[key]}</dt>
                <dd
                  data-testid={'stat-' + key}
                  className="break-all text-xl font-semibold text-primary tabular-nums"
                >
                  {new Intl.NumberFormat('zh-CN').format(query.data.data[key])}
                </dd>
              </div>
            ))}
          </dl>
        ) : query.isPending ? (
          <p role="status" className="flex-1 text-sm text-muted-foreground">
            正在读取社区统计…
          </p>
        ) : null}
      </div>
      {query.isError && (
        <FormNotice
          error={
            query.data
              ? '社区统计暂时无法更新，显示上次读取的数据'
              : '社区统计暂时不可用，连接恢复后自动更新'
          }
        />
      )}
    </section>
  );
}
