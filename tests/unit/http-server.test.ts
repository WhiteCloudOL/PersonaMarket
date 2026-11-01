import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { isFetchPort, listenHttp, reserveHttpOrigin } from '../../scripts/http-server.js';

it('复现 Fetch 对受限端口的拒绝，不放宽 Node 或浏览器的安全规则', async () => {
  await expect(fetch('http://127.0.0.1:6000/')).rejects.toMatchObject({
    cause: { message: 'bad port' },
  });
  for (const port of [0, 25, 6000, 6667, 10080, 65536]) expect(isFetchPort(port)).toBe(false);
  expect(isFetchPort(3100)).toBe(true);
});
it('拒绝受限候选后关闭监听，并继续用真实可访问端口提供 HTTP', async () => {
  const server = createServer((_request, response) => response.end('ready'));
  let calls = 0;
  try {
    const origin = await listenHttp({
      listen: (port, host) =>
        new Promise((resolve, reject) => {
          calls++;
          server.once('error', reject);
          server.listen(port, host, () => resolve(server));
        }),
      getUrl: async () => {
        if (calls === 1) return 'http://127.0.0.1:6000';
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('缺少监听地址');
        return 'http://127.0.0.1:' + address.port;
      },
    });
    expect(calls).toBe(2);
    expect(await (await fetch(origin)).text()).toBe('ready');
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('进程端口预留同样排除 Fetch 受限端口', async () => {
  const origin = await reserveHttpOrigin();
  expect(isFetchPort(Number(new URL(origin).port))).toBe(true);
});
