import { createServer, type Server } from 'node:net';

// WHATWG Fetch §2.9：https://fetch.spec.whatwg.org/#port-blocking
// 系统动态端口范围可能包含受限端口，listen(0) 不保证 Fetch 可访问
const forbidden = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);
export function isFetchPort(port: number) {
  return Number.isInteger(port) && port > 0 && port <= 65535 && !forbidden.has(port);
}
function close(server: Server) {
  return new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
export async function listenHttp(application: {
  listen: (port: number, host: string) => Promise<Server>;
  getUrl: () => Promise<string>;
}) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const server = await application.listen(0, '127.0.0.1');
    const origin = await application.getUrl();
    if (isFetchPort(Number(new URL(origin).port))) return origin;
    await close(server);
  }
  throw new Error('系统未能分配 Fetch 允许的测试端口，请检查本机动态端口范围');
}
/** 交给后续受控进程的端口预留；实际监听冲突仍应明确失败 */
export async function reserveHttpOrigin() {
  const server = createServer();
  try {
    return await listenHttp({
      listen: (port, host) =>
        new Promise<Server>((resolve, reject) => {
          const fail = (error: Error) => reject(error);
          server.once('error', fail);
          server.listen(port, host, () => {
            server.removeListener('error', fail);
            resolve(server);
          });
        }),
      getUrl: async () => {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('测试 HTTP 端口分配失败');
        return 'http://127.0.0.1:' + address.port;
      },
    });
  } finally {
    if (server.listening) await close(server);
  }
}
