import { createConnection, createServer, type Socket } from 'node:net';

/** 默认原样转发至本机Mailpit；可受控丢弃/延迟最终接收应答，不保存邮件或凭据 */
export async function createSmtpProbe(
  options: { dropAcceptance?: boolean; delayAcceptanceMs?: number } = {},
) {
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const observations = { submitted: 0, accepted: 0, connections: 0, tlsAttempts: 0 };
  const server = createServer((client) => {
    observations.connections++;
    const upstream = createConnection({ host: '127.0.0.1', port: 11025 });
    sockets.add(client);
    sockets.add(upstream);
    let clientBuffer = '',
      serverBuffer = '',
      inData = false,
      awaitingAcceptance = false;
    client.on('data', (chunk: Buffer) => {
      clientBuffer += chunk.toString('utf8');
      let end;
      while ((end = clientBuffer.indexOf('\r\n')) >= 0) {
        const line = clientBuffer.slice(0, end);
        clientBuffer = clientBuffer.slice(end + 2);
        if (inData) {
          if (line === '.') {
            observations.submitted++;
            inData = false;
            awaitingAcceptance = true;
          }
        } else if (line === 'DATA') inData = true;
        else if (line === 'STARTTLS') observations.tlsAttempts++;
      }
    });
    upstream.on('data', (chunk: Buffer) => {
      serverBuffer += chunk.toString('utf8');
      let end;
      while ((end = serverBuffer.indexOf('\r\n')) >= 0) {
        const line = serverBuffer.slice(0, end);
        serverBuffer = serverBuffer.slice(end + 2);
        if (awaitingAcceptance && /^[245]\d{2} /u.test(line)) {
          if (line.startsWith('250 ')) {
            observations.accepted++;
            if (options.dropAcceptance) {
              client.destroy();
              upstream.destroy();
              return;
            }
            if (options.delayAcceptanceMs) {
              const timer = setTimeout(() => {
                timers.delete(timer);
                if (!client.destroyed) client.write(line + '\r\n');
              }, options.delayAcceptanceMs);
              timers.add(timer);
              awaitingAcceptance = false;
              continue;
            }
          }
          awaitingAcceptance = false;
        }
        client.write(line + '\r\n');
      }
    });
    for (const [socket, other] of [
      [client, upstream],
      [upstream, client],
    ] as const) {
      socket.on('error', () => other.destroy());
      socket.on('close', () => {
        sockets.delete(socket);
        other.destroy();
      });
    }
    client.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('SMTP探针未取得本机端口');
  return {
    port: address.port,
    observations,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const timer of timers) clearTimeout(timer);
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
