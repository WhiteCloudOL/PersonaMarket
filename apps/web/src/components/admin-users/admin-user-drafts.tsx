'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { z } from 'zod';
import type { AdminUserDetailSchema } from '@personamarket/contracts';
import type { UserManagementValues } from './admin-user-form-schema';

type Snapshot = z.infer<typeof AdminUserDetailSchema>;
type RequestKey = { signature: string; key: string } | null;
type Draft = {
  snapshot: Snapshot;
  values: UserManagementValues;
  request: RequestKey;
  expires: number;
};
function memory() {
  const entries = new Map<string, Draft>();
  const key = (accountId: string, id: string) => accountId + ':' + id;
  function prune() {
    for (const [id, draft] of entries) if (draft.expires <= Date.now()) entries.delete(id);
  }
  return {
    read(accountId: string, id: string) {
      prune();
      return entries.get(key(accountId, id));
    },
    last(accountId: string) {
      prune();
      return [...entries.entries()].filter(([id]) => id.startsWith(accountId + ':')).at(-1)?.[1];
    },
    clear(accountId: string, id: string) {
      entries.delete(key(accountId, id));
    },
    write(
      accountId: string,
      snapshot: Snapshot,
      values: UserManagementValues,
      request: RequestKey,
    ) {
      prune();
      entries.delete(key(accountId, snapshot.id));
      // 仅在当前页面内短期保留五个未提交表单，避免无界积累或持久化私有管理信息。
      if (values.reason.length > 16000) return;
      if (entries.size >= 5) {
        const oldest = entries.keys().next().value;
        if (oldest) entries.delete(oldest);
      }
      entries.set(key(accountId, snapshot.id), {
        snapshot,
        values: { ...values },
        request,
        expires: Date.now() + 30 * 60_000,
      });
    },
  };
}
const DraftContext = createContext<ReturnType<typeof memory> | undefined>(undefined);
/** 页面认证边界之外、全站身份清理边界之内，同账号恢复可继续，主动退出和换号即销毁 */
export function AdminUserDraftProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(memory);
  return <DraftContext value={drafts}>{children}</DraftContext>;
}
export function useAdminUserDrafts() {
  const drafts = useContext(DraftContext);
  if (!drafts) throw new Error('用户管理表单缺少身份内存边界');
  return drafts;
}
