'use client';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FlagIcon } from 'lucide-react';
import type { CreateReport } from '@personamarket/contracts';
import { Button, buttonVariants } from '@personamarket/ui/components/button';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { authQuery } from '@/lib/auth-api';
import { FormNotice } from '../auth/auth-fields';
import { CreateReportForm } from './create-form';

const subscribe = () => () => {};
export function ReportButton({ target }: { target: CreateReport['target'] }) {
  const hydrated = useSyncExternalStore(
      subscribe,
      () => true,
      () => false,
    ),
    auth = useQuery(authQuery);
  const [open, setOpen] = useState(false),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const label =
    target.type === 'profile'
      ? '举报公开资料'
      : target.type === 'comment'
        ? '举报评论'
        : '举报人设';
  if (!hydrated || auth.isPending)
    return (
      <Button variant="ghost" disabled>
        {label}
      </Button>
    );
  if (auth.isError)
    return (
      <Button variant="ghost" onClick={() => void auth.refetch()}>
        重新确认举报权限
      </Button>
    );
  const account = auth.data.data.account;
  if (!account || auth.data.data.assurance !== 'authenticated')
    return (
      <Link
        className={buttonVariants({ variant: 'ghost' })}
        href={account ? '/mfa' : '/login'}
        aria-label={(account ? '验证后' : '登录后') + label}
      >
        <FlagIcon aria-hidden />
        {label}
      </Link>
    );
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!busy && (value || !dirty || window.confirm('举报说明尚未提交，确定关闭吗')))
          setOpen(value);
      }}
    >
      <SheetTrigger render={<Button variant="ghost" />}>
        <FlagIcon aria-hidden />
        {label}
      </SheetTrigger>
      <SheetContent showCloseButton={!busy} className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{label}</SheetTitle>
          <SheetDescription>说明你发现的问题，管理员会核对公开内容和相关线索</SheetDescription>
        </SheetHeader>
        <div className="flex min-w-0 flex-col gap-4 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-5">
          <FormNotice message="举报记录和补充说明仅提交者本人及管理员可读" />
          <CreateReportForm
            key={account.id}
            accountId={account.id}
            target={target}
            onDirty={setDirty}
            onBusy={setBusy}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
