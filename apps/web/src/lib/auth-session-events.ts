type AuthSessionEvent = 'refresh' | 'logout';
let channel: BroadcastChannel | undefined;
const listeners = new Set<(reason: AuthSessionEvent, local: boolean) => void>();
function connection() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
  if (!channel) {
    channel = new BroadcastChannel('personamarket-auth-session');
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      const reason = event.data;
      if (reason === 'refresh' || reason === 'logout')
        listeners.forEach((listener) => listener(reason, false));
    });
  }
  return channel;
}
export function announceAuthSession(reason: AuthSessionEvent = 'refresh') {
  // 只广播失效信号，接收窗口自行向API读取身份，不传输凭据或账号资料
  if (reason === 'logout') listeners.forEach((listener) => listener(reason, true));
  connection()?.postMessage(reason);
}
export function requestAuthSessionRefresh() {
  // 不携带身份资料，当前窗口和其他窗口都重新向API确认实际会话
  listeners.forEach((listener) => listener('refresh', false));
  connection()?.postMessage('refresh');
}
export function subscribeAuthSession(listener: (reason: AuthSessionEvent, local: boolean) => void) {
  listeners.add(listener);
  connection();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      channel?.close();
      channel = undefined;
    }
  };
}
