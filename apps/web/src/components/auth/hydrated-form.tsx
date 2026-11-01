'use client';

import type { ComponentProps } from 'react';
import { FieldSet } from '@personamarket/ui/components/field';
import { useHydrationReady } from '@/lib/use-hydration-ready';

/** 凭据只能由已接管的客户端通过认证 API 提交，避免原生 GET 将字段放入 URL。 */
export function HydratedForm({
  children,
  'aria-busy': busy,
  ...props
}: Omit<ComponentProps<'form'>, 'method' | 'action'>) {
  const ready = useHydrationReady();
  return (
    <form {...props} method="post" aria-busy={!ready || busy}>
      <FieldSet disabled={!ready} className="contents">
        {children}
      </FieldSet>
      <noscript>
        <p className="text-sm text-muted-foreground">请启用浏览器脚本后继续操作</p>
      </noscript>
    </form>
  );
}
