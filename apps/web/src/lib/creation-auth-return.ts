export const creationPath = '/dashboard/personas/new';
// 登录回跳仅接受已实现的创作入口，拒绝外站、协议相对地址和任意路径
export function creationReturnTo(value: unknown) {
  return value === creationPath ? creationPath : undefined;
}
export function retainsCreationDraft(target: URL, current: URL) {
  return (
    target.origin === current.origin &&
    current.pathname === creationPath &&
    (target.pathname === '/login' || target.pathname === '/mfa') &&
    target.searchParams.get('returnTo') === creationPath
  );
}
