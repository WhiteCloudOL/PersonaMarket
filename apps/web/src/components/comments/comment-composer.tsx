'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { CommentSettings, PublicComment } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { commentsApi } from '@/lib/comments-api';
import { CommentBodyForm } from './comment-body-form';

export type CommentAccess = 'ready' | 'guest' | 'unverified' | 'mfa' | 'loading' | 'error';
function AccessNotice({ access }: { access: CommentAccess }) {
  if (access === 'ready') return null;
  return (
    <div className="flex flex-col items-start gap-3 text-sm leading-7 text-muted-foreground">
      <p>
        {access === 'guest'
          ? '登录后可以发表评论，当前未提交的输入会保留'
          : access === 'unverified'
            ? '验证邮箱后可以发表评论'
            : access === 'mfa'
              ? '请完成登录 MFA 后继续评论'
              : access === 'error'
                ? '暂时无法确认登录状态，请稍后重试'
                : '正在确认登录状态…'}
      </p>
      {access === 'guest' && (
        <Button
          variant="outline"
          render={<Link href="/login" target="_blank" rel="noopener noreferrer" />}
        >
          在新窗口登录
        </Button>
      )}
      {access === 'unverified' && (
        <Button variant="outline" render={<Link href="/account" />}>
          前往账号设置
        </Button>
      )}
      {access === 'mfa' && (
        <Button
          variant="outline"
          render={<Link href="/mfa" target="_blank" rel="noopener noreferrer" />}
        >
          完成登录验证
        </Button>
      )}
    </div>
  );
}
const resultMessage = (status: string) =>
  status === 'APPROVED' ? '评论已公开' : '评论已提交，等待审核后公开';

export function CommentComposer({
  personaId,
  releaseId,
  version,
  actorId,
  access,
  settings,
  onChanged,
}: {
  personaId: string;
  releaseId: string;
  version: string;
  actorId: string | undefined;
  access: CommentAccess;
  settings: CommentSettings;
  onChanged: () => Promise<void>;
}) {
  return (
    <Card id="comment-composer" className="min-w-0 scroll-mt-28">
      <CardHeader>
        <CardTitle>
          <h3>写下你的体验</h3>
        </CardTitle>
        <CardDescription>针对 v{version}，评论会保留版本引用</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <AccessNotice access={access} />
        {!settings.commentsEnabled && (
          <p className="text-sm leading-7 text-muted-foreground">
            站点已暂停新建和编辑评论，当前输入会保留
          </p>
        )}
        <p className="text-sm leading-7 text-muted-foreground">
          {settings.commentReviewMode === 'all'
            ? '新评论和编辑文本均需审核，其他用户只会看到获批内容'
            : '当前关闭预审，提交后自动批准并记录处理依据'}
        </p>
        {actorId && (
          <CommentBodyForm
            key={actorId}
            draftKey={actorId + ':' + personaId + ':' + releaseId}
            retainedDocument={{ personaId, releaseId }}
            maxLength={settings.commentMaxLength}
            label="评论内容"
            submitLabel="提交评论"
            disabled={access !== 'ready' || !settings.commentsEnabled}
            requestScope={personaId + ':' + releaseId}
            onSubmit={async (body, key) => {
              const result = await commentsApi.create(actorId, personaId, { body, releaseId }, key);
              await onChanged();
              return { body: '', message: resultMessage(result.data.latest.status) };
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function CommentReplyEditor({
  target,
  rootId,
  personaId,
  releaseId,
  accountId,
  access,
  settings,
  onClose,
  onChanged,
}: {
  target: Extract<PublicComment, { status: 'published' }>;
  rootId: string;
  personaId: string;
  releaseId: string;
  accountId: string;
  access: CommentAccess;
  settings: CommentSettings;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy && (!dirty || window.confirm('回复还有未提交的内容，确定关闭吗')))
          onClose();
      }}
    >
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>回复 @{target.author.username}</SheetTitle>
          <SheetDescription>回复保留在同一个一级楼层中，审核通过后才会公开</SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-5 px-4 pb-6">
          <blockquote className="whitespace-pre-wrap rounded-xl border bg-muted p-4 text-sm leading-7 [overflow-wrap:anywhere]">
            {target.body}
          </blockquote>
          <AccessNotice access={access} />
          {!settings.commentsEnabled && (
            <p className="text-sm text-muted-foreground">
              站点已暂停新建和编辑评论，当前输入会保留
            </p>
          )}
          <CommentBodyForm
            maxLength={settings.commentMaxLength}
            label="回复内容"
            submitLabel="提交回复"
            requestScope={rootId + ':' + target.id + ':' + releaseId}
            disabled={access !== 'ready' || !settings.commentsEnabled}
            onDirtyChange={setDirty}
            onBusyChange={setBusy}
            onSubmit={async (body, key) => {
              const result = await commentsApi.create(
                accountId,
                personaId,
                { body, parentId: rootId, replyToId: target.id, releaseId },
                key,
              );
              await onChanged();
              onClose();
              return { body: '', message: resultMessage(result.data.latest.status) };
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
