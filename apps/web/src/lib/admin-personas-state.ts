/** 管理视图内的记录翻页保留面板草稿，身份或作品变化由上层边界清理 */
export function retainsPersonaPanelDraft(target: URL, current: URL) {
  if (target.origin !== current.origin || target.pathname !== current.pathname) return false;
  const id = current.searchParams.get('personaId');
  if (!id || target.searchParams.get('personaId') !== id) return false;
  const localViews = new Set(['recordsPage', 'personaView']);
  const keys = new Set([...target.searchParams.keys(), ...current.searchParams.keys()]);
  for (const key of keys) {
    if (
      !localViews.has(key) &&
      JSON.stringify(target.searchParams.getAll(key)) !==
        JSON.stringify(current.searchParams.getAll(key))
    )
      return false;
  }
  return true;
}
