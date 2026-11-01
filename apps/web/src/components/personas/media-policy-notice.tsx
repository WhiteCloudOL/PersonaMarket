'use client';
import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';
import type { PublicMediaSettingsResponseSchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@personamarket/ui/components/collapsible';
import { FormNotice } from '../auth/auth-fields';
import { MediaSettingsSummary } from '../settings/media-settings-summary';

export function MediaPolicyNotice({
  policy,
}: {
  policy: UseQueryResult<z.infer<typeof PublicMediaSettingsResponseSchema>>;
}) {
  const [open, setOpen] = useState(false);
  const data = policy.data?.data;
  return (
    <div className="flex min-w-0 flex-col items-start gap-3">
      {policy.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          正在读取图片设置…
        </p>
      )}
      {policy.isError && (
        <>
          <FormNotice error={policy.error} />
          <Button type="button" variant="outline" onClick={() => void policy.refetch()}>
            重新读取图片设置
          </Button>
        </>
      )}
      {data && (
        <>
          <p className="text-sm text-muted-foreground">
            单张原图最大 {data.maxImageKiB} KiB · 新版本 README 最多 {data.maxReadmeImages} 张图片
          </p>
          {(!data.uploadsEnabled || !data.remoteImportsEnabled) && (
            <p role="status" className="text-sm text-muted-foreground">
              {!data.uploadsEnabled ? '本地图片上传已关闭，已有素材仍可引用' : ''}
              {!data.uploadsEnabled && !data.remoteImportsEnabled ? ' · ' : ''}
              {!data.remoteImportsEnabled ? '在线图片导入已关闭' : ''}
            </p>
          )}
          <Collapsible open={open} onOpenChange={setOpen} className="w-full min-w-0">
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-11 max-w-full py-2 whitespace-normal"
                />
              }
            >
              {open ? '收起图片限额与来源' : '查看图片限额与来源'}
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <MediaSettingsSummary value={data} />
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </div>
  );
}
