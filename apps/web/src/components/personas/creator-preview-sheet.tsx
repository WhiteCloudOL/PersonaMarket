'use client';
import { useRef, type ReactNode } from 'react';
import type { ContentLimits } from '@personamarket/contracts';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@personamarket/ui/components/sheet';
import { CreatorCard } from './creator-preview';
import { DraftChecks, navigateToDraftField } from './draft-checks';

export function CreatorPreviewSheet({
  open,
  onOpenChange,
  limits,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limits?: ContentLimits;
  children?: ReactNode;
}) {
  const pendingNavigation = useRef<{ anchor: string; path?: string } | null>(null);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => {
        const destination = pendingNavigation.current;
        if (!next && destination) {
          pendingNavigation.current = null;
          navigateToDraftField(destination.anchor, destination.path);
        }
      }}
    >
      <SheetContent side="bottom" className="flex max-h-[92dvh] flex-col rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>发布预览</SheetTitle>
          <SheetDescription>预览随输入更新，保存后再创建版本</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <CreatorCard />
          <DraftChecks
            {...(limits ? { limits } : {})}
            onNavigate={(anchor, path) => {
              pendingNavigation.current = { anchor, ...(path ? { path } : {}) };
              onOpenChange(false);
            }}
          >
            {children}
          </DraftChecks>
        </div>
      </SheetContent>
    </Sheet>
  );
}
