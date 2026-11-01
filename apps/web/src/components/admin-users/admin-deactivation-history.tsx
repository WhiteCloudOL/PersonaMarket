'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { z } from 'zod';
import type { AdminDeactivationRequestSchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';

const labels = {
  pending: '待处理',
  withdrawn: '已撤回',
  approved: '已批准',
  rejected: '已驳回',
} as const;
export function AdminDeactivationHistory({
  requests,
}: {
  requests: Array<z.infer<typeof AdminDeactivationRequestSchema>>;
}) {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const totalPages = Math.max(1, Math.ceil(requests.length / 20));
  const rawPage = Number(search.get('applicationPage') ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= totalPages ? rawPage : 1;
  function turn(nextPage: number) {
    const next = new URLSearchParams(search);
    if (nextPage === 1) next.delete('applicationPage');
    else next.set('applicationPage', String(nextPage));
    router.push(pathname + '?' + next, { scroll: false });
  }
  return (
    <section aria-label="停用申请记录" className="flex min-w-0 flex-col gap-4">
      <h2 className="text-lg font-semibold">停用申请记录</h2>
      <p className="text-sm text-muted-foreground">
        保留最近 100 条申请与处理决定，账号停用不自动删除或下架作品
      </p>
      {requests.length === 0 ? (
        <p className="text-muted-foreground">还没有停用申请</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {requests.slice((page - 1) * 20, page * 20).map((request) => (
            <li key={request.id} className="flex min-w-0 flex-col gap-2 border-t pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{labels[request.status]}</Badge>
                <time dateTime={request.createdAt} className="text-sm text-muted-foreground">
                  {new Date(request.createdAt).toLocaleString('zh-CN')}
                </time>
              </div>
              <p
                className="max-h-48 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]"
                tabIndex={0}
              >
                {request.reason}
              </p>
              {request.decision && (
                <>
                  <p className="break-words text-sm font-medium">
                    {request.decision.decision === 'approve' ? '批准停用' : '驳回申请'} ·{' '}
                    {request.decision.actor.username}
                  </p>
                  <p
                    className="max-h-48 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]"
                    tabIndex={0}
                  >
                    {request.decision.reason}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(request.decision.createdAt).toLocaleString('zh-CN')} · 撤销{' '}
                    {request.decision.revokedSessions} 个会话
                  </p>
                </>
              )}
              {!request.decision && ['approved', 'rejected'].includes(request.status) && (
                <p className="text-sm text-muted-foreground">该历史申请没有可读取的处理详情</p>
              )}
            </li>
          ))}
        </ol>
      )}
      {totalPages > 1 && (
        <nav
          aria-label="停用申请记录分页"
          className="flex flex-wrap items-center justify-center gap-3"
        >
          <Button variant="outline" disabled={page <= 1} onClick={() => turn(page - 1)}>
            较新申请
          </Button>
          <span>
            第 {page} / {totalPages} 页
          </span>
          <Button variant="outline" disabled={page >= totalPages} onClick={() => turn(page + 1)}>
            较早申请
          </Button>
        </nav>
      )}
    </section>
  );
}
