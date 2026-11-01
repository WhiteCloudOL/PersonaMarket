'use client';
import { useQuery } from '@tanstack/react-query';
import type { PublicSystemStatusResponse } from '@personamarket/contracts';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { Button } from '@personamarket/ui/components/button';
import { publicSystemStatusQuery } from '@/lib/system-status-api';
import { useHydrationReady } from '@/lib/use-hydration-ready';

export function PublicMaintenanceBanner({
  initial,
}: {
  initial: PublicSystemStatusResponse | null;
}) {
  const ready = useHydrationReady();
  const query = useQuery({
    ...publicSystemStatusQuery,
    enabled: ready,
    ...(initial ? { initialData: initial } : {}),
  });
  // 其他流式边界可能已更新同一查询；首次水合仍使用本边界的SSR快照
  const data = ready ? query.data : initial;
  const unavailable = ready ? query.isError : initial === null;
  if (!unavailable && !data)
    return (
      <div
        className="mx-auto w-full max-w-[86rem] px-4 py-3 text-sm text-muted-foreground lg:px-8"
        role="status"
      >
        正在核对维护状态…
      </div>
    );
  if (!unavailable && data && !data.data.maintenanceEnabled) return null;
  return (
    <div className="mx-auto w-full max-w-[86rem] px-4 pt-4 sm:px-6 lg:px-8">
      <Alert
        aria-label={unavailable ? '维护状态读取提示' : '站点维护提示'}
        data-public-maintenance-banner
        data-maintenance-state={unavailable ? 'unknown' : 'on'}
      >
        <AlertTitle>{unavailable ? '暂时无法核对维护状态' : '站点维护中'}</AlertTitle>
        <AlertDescription className="flex min-w-0 flex-col items-start gap-3">
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            {unavailable
              ? '当前状态尚未确认，登录与账号恢复入口仍可使用，请重新读取后核对'
              : data?.data.maintenanceMessage || '新业务提交暂时停止，登录与账号恢复仍可使用'}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={!ready || query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching && ready ? '正在核对…' : '核对维护状态'}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
