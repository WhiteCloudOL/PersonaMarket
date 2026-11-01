'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
import { Button } from '@personamarket/ui/components/button';
import { publicSystemStatusQuery } from '@/lib/system-status-api';
import { useHydrationReady } from '@/lib/use-hydration-ready';

export function MaintenanceWriteNotice({ message }: { message: string }) {
  const ready = useHydrationReady();
  const [checked, setChecked] = useState(false);
  const query = useQuery({ ...publicSystemStatusQuery, enabled: false });
  return (
    <Alert aria-label="维护提交提示">
      <AlertTitle>刚才的提交因维护暂停</AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col items-start gap-3">
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message}</p>
        <p>当前输入保留，核对状态不会重新提交；维护结束后请主动重试刚才的操作</p>
        <Button
          type="button"
          variant="outline"
          disabled={!ready || query.isFetching}
          onClick={() => {
            setChecked(true);
            void query.refetch();
          }}
        >
          {query.isFetching ? '正在核对…' : '核对维护状态'}
        </Button>
        {checked && (
          <p role="status">
            {query.isFetching
              ? '正在读取当前维护状态'
              : query.isError
                ? '暂时无法核对维护状态，请稍后重新读取'
                : query.data
                  ? query.data.data.maintenanceEnabled
                    ? '仍在维护中，请稍后重新核对'
                    : '当前维护已关闭，请自行重试刚才的操作'
                  : '当前维护状态尚未确认'}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
