'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { PersonaDraft } from '@personamarket/contracts';

export type CreationBuffers = {
  maibot: Extract<PersonaDraft, { platform: 'maibot' }>['content'];
  astrbot: Extract<PersonaDraft, { platform: 'astrbot' }>['content'];
};
type Owner = { id: string; role: string } | null;
type Draft = { owner: Owner; draft: PersonaDraft; buffers: CreationBuffers; expires: number };
function memory() {
  let saved: Draft | undefined;
  return {
    write(owner: Owner, draft: PersonaDraft, buffers: CreationBuffers) {
      saved = structuredClone({ owner, draft, buffers, expires: Date.now() + 30 * 60_000 });
    },
    take(owner: Owner) {
      const current = saved;
      saved = undefined;
      if (!current || current.expires <= Date.now()) return;
      if (current.owner && (current.owner.id !== owner?.id || current.owner.role !== owner?.role))
        return;
      return current;
    },
    clear() {
      saved = undefined;
    },
  };
}
const DraftContext = createContext<ReturnType<typeof memory> | undefined>(undefined);
/** 只保留本标签页一次登录往返，主动退出或身份切换由上层身份边界销毁 */
export function CreationDraftProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(memory);
  return <DraftContext value={drafts}>{children}</DraftContext>;
}
export function useCreationDrafts() {
  const drafts = useContext(DraftContext);
  if (!drafts) throw new Error('创作表单缺少身份内存边界');
  return drafts;
}
