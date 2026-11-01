'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CopyIcon, CheckIcon, type LucideIcon } from 'lucide-react';
import { Button } from '@personamarket/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { Textarea } from '@personamarket/ui/components/textarea';
export function CopyTextButton({
  label,
  readText,
  primary = false,
  icon: Icon = CopyIcon,
}: {
  label: string;
  readText: () => string | Promise<string>;
  primary?: boolean;
  icon?: LucideIcon;
}) {
  const [fallback, setFallback] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const text = await readText();
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        setFallback(text);
        return false;
      }
    },
    retry: false,
  });
  return (
    <>
      <Button
        type="button"
        variant={primary ? 'default' : 'outline'}
        size={primary ? 'default' : 'sm'}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.data === true ? <CheckIcon aria-hidden /> : <Icon aria-hidden />}
        {mutation.isPending ? '正在读取…' : mutation.data === true ? '已复制' : label}
      </Button>
      {mutation.error && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
      <Sheet
        open={fallback !== null}
        onOpenChange={(open) => {
          if (!open) setFallback(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>选择并复制文本</SheetTitle>
            <SheetDescription>浏览器未能写入剪贴板，请选中文本后手动复制</SheetDescription>
          </SheetHeader>
          <div className="p-5">
            <Textarea
              aria-label="待复制内容"
              readOnly
              value={fallback ?? ''}
              onFocus={(event) => event.currentTarget.select()}
              className="min-h-80"
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
