import { CommentsQuerySchema, IdSchema } from '@personamarket/contracts';

export type CommentDocumentIdentity = { personaId: string; releaseId: string };

export function commentPage(value: string | null) {
  const parsed = CommentsQuerySchema.shape.page.safeParse(value ?? 1);
  return parsed.success ? parsed.data : 1;
}

/** 讨论条件或明确绑定的同版章节导航会保留当前身份的内存草稿；跨版本仍需离开确认。 */
export function retainsCommentDraft(
  target: URL,
  current: URL,
  documentIdentity?: CommentDocumentIdentity,
) {
  if (target.origin !== current.origin) return false;
  if (target.pathname !== current.pathname) {
    const persona = IdSchema.safeParse(documentIdentity?.personaId);
    const release = IdSchema.safeParse(documentIdentity?.releaseId);
    if (!persona.success || !release.success) return false;
    if (
      current.pathname !== '/personas/' + persona.data ||
      target.pathname !== '/personas/' + persona.data + '/releases/' + release.data
    )
      return false;
    let fragment: string;
    try {
      fragment = decodeURIComponent(target.hash);
    } catch {
      return false;
    }
    const prefix = '#pm-readme-' + release.data + '-';
    if (
      !fragment.startsWith(prefix) ||
      !/^\d+$/.test(fragment.slice(prefix.length)) ||
      !Number.isSafeInteger(Number(fragment.slice(prefix.length)))
    )
      return false;
  }
  const next = new URLSearchParams(target.search);
  const previous = new URLSearchParams(current.search);
  for (const name of [
    'commentsPage',
    'myCommentsPage',
    'repliesPage',
    'replyThread',
    'commentsSort',
  ]) {
    next.delete(name);
    previous.delete(name);
  }
  return next.toString() === previous.toString();
}
