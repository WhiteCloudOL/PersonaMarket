'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { canonicalJson } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { FormNotice } from '../auth/auth-fields';
import { personasApi } from '@/lib/personas-api';
import { releasesApi } from '@/lib/releases-api';
import type { Submission } from '@personamarket/contracts';
export function RestoreDraft({
  submission,
  onSuccess,
}: {
  submission: Submission;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = useMutation({
    mutationFn: () => personasApi.read(submission.personaId),
    retry: false,
  });
  const restore = useMutation({
    mutationFn: () => {
      if (!current.data) throw new Error('请先读取服务器草稿');
      return releasesApi.restore(submission.personaId, submission.id, current.data.meta.revision);
    },
    onSuccess: () => {
      setOpen(false);
      onSuccess();
    },
    retry: false,
  });
  const labels = {
    title: '人设名称',
    summary: '简介',
    content: '正文',
    readmeMarkdown: 'README',
    recommendedModels: '推荐模型',
    origin: '来源与许可',
    authorNotes: '作者说明',
    categoryId: '分类',
    tagIds: '标签',
    avatarAssetId: '头像',
    coverAssetId: '封面',
  };
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true);
          restore.reset();
          current.mutate();
        }}
      >
        复制为当前草稿
      </Button>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!restore.isPending) setOpen(next);
        }}
      >
        <SheetContent className="overflow-hidden sm:max-w-3xl" showCloseButton={!restore.isPending}>
          <SheetHeader>
            <SheetTitle>用版本快照替换草稿</SheetTitle>
            <SheetDescription>
              检查服务器草稿与 v{submission.version}{' '}
              的差异，其他页面有未保存内容时请先备份；已发布版本保持可用
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-5">
            <FormNotice error={current.error ?? restore.error} />
            {current.isPending && <p role="status">正在读取服务器草稿…</p>}
            {current.data && (
              <>
                <p className="text-sm text-muted-foreground">
                  当前草稿版本 {current.data.meta.revision} · 更新于{' '}
                  {new Date(current.data.data.updatedAt).toLocaleString('zh-CN')}
                </p>
                {Object.entries(labels)
                  .filter(
                    ([key]) =>
                      canonicalJson(Reflect.get(current.data.data.draft, key)) !==
                      canonicalJson(Reflect.get(submission.snapshot, key)),
                  )
                  .map(([key, label]) => (
                    <section key={key} className="rounded-xl border p-4">
                      <h2 className="mb-3 font-medium">{label}</h2>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="min-w-0">
                          <p className="mb-2 text-xs text-muted-foreground">服务器草稿</p>
                          <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all text-xs leading-6">
                            {JSON.stringify(Reflect.get(current.data.data.draft, key), null, 2) ??
                              '空'}
                          </pre>
                        </div>
                        <div className="min-w-0 rounded-lg bg-accent/40 p-3">
                          <p className="mb-2 text-xs text-muted-foreground">版本快照</p>
                          <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all text-xs leading-6">
                            {JSON.stringify(Reflect.get(submission.snapshot, key), null, 2) ?? '空'}
                          </pre>
                        </div>
                      </div>
                    </section>
                  ))}
                <Button type="button" disabled={restore.isPending} onClick={() => restore.mutate()}>
                  {restore.isPending ? '正在替换…' : '确认覆盖草稿'}
                </Button>
              </>
            )}
            {current.isError && (
              <Button type="button" variant="outline" onClick={() => current.mutate()}>
                重试读取草稿
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
