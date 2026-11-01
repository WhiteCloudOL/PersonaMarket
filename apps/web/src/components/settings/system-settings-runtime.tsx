'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { Separator } from '@personamarket/ui/components/separator';
import { systemSettingsApi, systemSettingsKey } from '@/lib/system-settings-api';
import { FormNotice } from '../auth/auth-fields';

export function SystemSettingsRuntime({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const runtime = useQuery({
    queryKey: [...systemSettingsKey(accountId), 'runtime'],
    queryFn: ({ signal }) => systemSettingsApi.runtime(accountId, signal),
    enabled: open,
    retry: false,
  });
  const readiness = useQuery({
    queryKey: [...systemSettingsKey(accountId), 'readiness'],
    queryFn: ({ signal }) => systemSettingsApi.readiness(signal),
    enabled: false,
    retry: false,
  });
  const [checked, setChecked] = useState(false);
  const value = runtime.data?.data;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button type="button" variant="outline" />}>
        {open ? '收起运行信息' : '查看运行信息'}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">
        {open && (
          <Card role="region" aria-label="API运行信息">
            <CardHeader>
              <CardTitle>
                <h2>API运行信息</h2>
              </CardTitle>
              <CardDescription>
                只表示当前API产物和本次读取，不能据此确认Web或Worker版本
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-5">
              {runtime.isFetching ? (
                <p role="status">正在读取API运行信息…</p>
              ) : runtime.isError ? (
                <FormNotice error={runtime.error} />
              ) : value ? (
                <>
                  <dl className="grid min-w-0 gap-4 text-sm leading-7 sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">组件</dt>
                      <dd>API</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">实际Node版本</dt>
                      <dd>{value.nodeVersion}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">构建元数据</dt>
                      <dd>
                        {value.build.status === 'available'
                          ? '来自API构建产物'
                          : '未知，尚无有效构建元数据'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">产物版本</dt>
                      <dd>
                        {value.build.status === 'available'
                          ? (value.build.version ?? '未提供')
                          : '未知'}
                      </dd>
                    </div>
                    <div className="min-w-0 sm:col-span-2">
                      <dt className="text-muted-foreground">源码修订</dt>
                      <dd className="[overflow-wrap:anywhere]">
                        {value.build.status === 'available'
                          ? (value.build.sourceRevision ?? '未知')
                          : '未知'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">构建时源码状态</dt>
                      <dd>
                        {value.build.status !== 'available' || value.build.sourceDirty === null
                          ? '未知'
                          : value.build.sourceDirty
                            ? '包含未提交修改'
                            : '源码干净'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">产物构建时间</dt>
                      <dd className="[overflow-wrap:anywhere]">
                        {value.build.status === 'available' && value.build.builtAt ? (
                          <time dateTime={value.build.builtAt}>{value.build.builtAt}</time>
                        ) : (
                          '未知'
                        )}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p role="status">API运行信息尚未确认</p>
              )}
              <Button
                type="button"
                variant="outline"
                className="self-start"
                disabled={runtime.isFetching}
                onClick={() => void runtime.refetch()}
              >
                重新读取API信息
              </Button>
              <Separator />
              <div className="flex flex-col items-start gap-3">
                <h3 className="font-medium">必要服务就绪</h3>
                <p className="text-sm leading-7 text-muted-foreground">
                  检查数据库初始化读取与Redis探测，不包含SMTP投递、Worker活性或磁盘完整检查
                </p>
                {checked &&
                  (readiness.isFetching ? (
                    <p role="status">正在检查必要服务…</p>
                  ) : readiness.isError ? (
                    <FormNotice error={readiness.error} />
                  ) : readiness.data ? (
                    <p role="status">本次必要服务就绪检查通过</p>
                  ) : (
                    <p role="status">尚无法确认必要服务状态</p>
                  ))}
                <Button
                  type="button"
                  variant="outline"
                  disabled={readiness.isFetching}
                  onClick={() => {
                    setChecked(true);
                    void readiness.refetch();
                  }}
                >
                  检查必要服务就绪
                </Button>
              </div>
              <nav aria-label="系统观测入口" className="flex flex-wrap gap-3">
                <Link href="/admin" className={buttonVariants({ variant: 'outline' })}>
                  查看运行观测
                </Link>
                <Link href="/admin/tasks" className={buttonVariants({ variant: 'outline' })}>
                  查看失败任务
                </Link>
              </nav>
            </CardContent>
          </Card>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
