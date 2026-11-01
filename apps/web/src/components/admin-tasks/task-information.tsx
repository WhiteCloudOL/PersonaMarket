'use client';
import type { AdminTaskFailure } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { ChevronDownIcon } from 'lucide-react';
import { taskDate, taskStageName } from './task-fields';

export function TaskInformation({ task }: { task: AdminTaskFailure }) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={<Button type="button" variant="outline" className="w-full justify-between" />}
      >
        任务信息
        <ChevronDownIcon data-icon="inline-end" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="grid min-w-0 gap-4 pt-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted-foreground">核对时阶段</dt>
            <dd>{taskStageName(task.stage)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">创建时间</dt>
            <dd>{taskDate(task.createdAt)} · 北京时间</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">分发尝试</dt>
            <dd>{task.dispatchAttempts === null ? '未记录' : task.dispatchAttempts + ' 次'}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">执行尝试</dt>
            <dd>{task.executionAttempts === null ? '未记录' : task.executionAttempts + ' 次'}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-sm text-muted-foreground">错误码</dt>
            <dd className="[overflow-wrap:anywhere]">{task.errorCode}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-sm text-muted-foreground">任务标识</dt>
            <dd className="[overflow-wrap:anywhere]">{task.id}</dd>
          </div>
        </dl>
        <p className="pt-4 text-sm text-muted-foreground">
          分发与执行次数分别记录，无法核验的次数显示为未记录
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
