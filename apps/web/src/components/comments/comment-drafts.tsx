'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';

type Draft = { body: string; expires: number };
function memory() {
  const entries = new Map<string, Draft>();
  function prune() {
    const now = Date.now();
    for (const [key, draft] of entries) if (draft.expires <= now) entries.delete(key);
  }
  return {
    read(key: string) {
      prune();
      return entries.get(key)?.body;
    },
    write(key: string, body: string) {
      prune();
      entries.delete(key);
      // 仅保存本标签页短期未提交的新评论，不能进入浏览器持久化存储
      if (!body || Array.from(body).length > 2000) return;
      if (entries.size >= 40) {
        const oldest = entries.keys().next().value;
        if (oldest) entries.delete(oldest);
      }
      entries.set(key, { body, expires: Date.now() + 30 * 60_000 });
    },
  };
}
const DraftContext = createContext<ReturnType<typeof memory> | undefined>(undefined);
/** 置于身份边界内：同账号返回页面可继续，换号、角色变化和主动退出时整体销毁 */
export function CommentDraftProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(memory);
  return <DraftContext value={drafts}>{children}</DraftContext>;
}
export function useCommentDrafts() {
  return useContext(DraftContext);
}
