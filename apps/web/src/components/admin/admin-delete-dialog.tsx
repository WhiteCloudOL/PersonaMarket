'use client';

import { useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteAdminPersona, deleteAdminUser } from '@personamarket/api-client';
import { AuthNoticeResponseSchema } from '@personamarket/contracts';
import { Button } from '@personamarket/ui/components/button';
import { Input } from '@personamarket/ui/components/input';
import { Field, FieldDescription, FieldLabel } from '@personamarket/ui/components/field';
import { ToggleGroup, ToggleGroupItem } from '@personamarket/ui/components/toggle-group';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@personamarket/ui/components/alert-dialog';
import { authenticatedWriteFor, sessionRequestOptions } from '@/lib/auth-api';
import { FormNotice } from '../auth/auth-fields';

type Target = { id: string; label: string; revision: number } & (
  { kind: 'user' } | { kind: 'persona' }
);
type Mode = 'keep_anonymous' | 'remove_content';

export function AdminDeleteDialog({
  accountId,
  target,
  disabled,
  deleted,
}: {
  accountId: string;
  target: Target;
  disabled: boolean;
  deleted: () => void;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>();
  const [username, setUsername] = useState('');
  const cancel = useRef<HTMLButtonElement>(null);
  const request = useRef<{ signature: string; key: string } | undefined>(undefined);
  const id = useId();
  const account = target.kind === 'user';
  const action = account ? '删除账号' : '删除人设';
  const ready = !account || (mode !== undefined && username === target.label);
  const mutation = useMutation({
    mutationFn: () => {
      const signature = JSON.stringify([target.id, target.revision, mode, username]);
      if (request.current?.signature !== signature)
        request.current = { signature, key: crypto.randomUUID() };
      const key = request.current.key;
      if (target.kind === 'user' && !mode) throw new Error('请选择作品和评论的处理方式');
      return authenticatedWriteFor(
        accountId,
        (header) => {
          const options = {
            ...sessionRequestOptions,
            headers: { 'X-Expected-Account': accountId },
            params: { path: { id: target.id }, header: { ...header, 'Idempotency-Key': key } },
            signal: AbortSignal.timeout(12000),
          };
          return target.kind === 'user' && mode
            ? deleteAdminUser({
                ...options,
                body: { expectedSecurityVersion: target.revision, mode, username },
              })
            : deleteAdminPersona({
                ...options,
                body: { expectedRevision: target.revision, confirmed: true },
              });
        },
        AuthNoticeResponseSchema,
      );
    },
    retry: false,
    onSuccess: () => {
      setOpen(false);
      deleted();
      for (const key of ['admin-users', 'admin-personas', 'review-indicators'])
        void client.invalidateQueries({ queryKey: ['private', key, accountId] });
    },
  });
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (mutation.isPending) return;
        if (value) {
          setMode(undefined);
          setUsername('');
          mutation.reset();
        }
        setOpen(value);
      }}
    >
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="w-fit text-destructive"
            disabled={disabled}
          />
        }
      >
        {action}
      </AlertDialogTrigger>
      <AlertDialogContent
        initialFocus={cancel}
        className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto overscroll-contain sm:max-w-md"
      >
        <AlertDialogTitle>{action}</AlertDialogTitle>
        <AlertDialogDescription className="[overflow-wrap:anywhere]">
          {target.label || '未命名人设'}。
          {account
            ? '登录凭据将清除，所有设备将退出，原用户名和邮箱可重新注册。'
            : '草稿、公开页及所有历史版本将无法访问，正在审核的版本会撤回。'}
          此操作不可撤销，内部审核和审计记录会保留。
        </AlertDialogDescription>
        {account && (
          <>
            <Field>
              <FieldLabel id={id + '-mode'}>作品和评论</FieldLabel>
              <ToggleGroup
                aria-labelledby={id + '-mode'}
                className="flex flex-wrap"
                variant="outline"
                value={mode ? [mode] : []}
                disabled={mutation.isPending}
                onValueChange={(values) => {
                  const selected = values[0];
                  setMode(
                    selected === 'keep_anonymous' || selected === 'remove_content'
                      ? selected
                      : undefined,
                  );
                }}
              >
                <ToggleGroupItem value="keep_anonymous">匿名保留</ToggleGroupItem>
                <ToggleGroupItem value="remove_content">一并移除</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>
                {mode === 'remove_content'
                  ? '该账号的作品、历史版本和评论将从站点移除。'
                  : '匿名保留会把已公开作品和评论的作者标为「已删除用户」。'}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={id + '-username'}>输入用户名确认</FieldLabel>
              <Input
                id={id + '-username'}
                name="username"
                autoComplete="off"
                spellCheck={false}
                disabled={mutation.isPending}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
          </>
        )}
        <FormNotice error={mutation.error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            ref={cancel}
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => setOpen(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!ready || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? '正在删除…' : '永久删除'}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
