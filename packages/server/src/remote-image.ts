import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { BusinessError } from './errors.js';
const invalid = () =>
  new BusinessError('INVALID_INPUT', '图片地址不可访问，请使用公网 HTTPS 静态图片');
export function publicImageAddress(value: string) {
  try {
    const address = ipaddr.process(value);
    return address.range() === 'unicast';
  } catch {
    return false;
  }
}
export function checkedImageUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    url.hash ||
    url.href.length > 2048
  )
    throw invalid();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !publicImageAddress(host)) throw invalid();
  return url;
}
/** 所有 DNS 地址必须为公网；每一跳独立检查，并固定连接地址、TLS SNI 与实际 peer。 */
export async function downloadPublicImage(
  value: string,
  options: { checkTarget?: (url: URL) => void | Promise<void>; maxBytes?: number } = {},
): Promise<Buffer> {
  const maximum = Math.min(options.maxBytes ?? 5242880, 5242880);
  if (!Number.isSafeInteger(maximum) || maximum <= 0) throw invalid();
  const deadline = Date.now() + 10000;
  let target = checkedImageUrl(value);
  for (let redirect = 0; redirect <= 3; redirect++) {
    await options.checkTarget?.(target);
    const host = target.hostname.replace(/^\[|\]$/g, '');
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw invalid();
    const answers = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(invalid()), remaining);
        timer.unref();
      }),
    ]);
    if (!answers.length || answers.some((answer) => !publicImageAddress(answer.address)))
      throw invalid();
    const selected = answers[0];
    if (!selected) throw invalid();
    const result = await new Promise<{ bytes?: Buffer; location?: string }>((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
      const cleanup = () => clearTimeout(timer);
      const req = request(
        target,
        {
          agent: false,
          servername: isIP(host) ? '' : host,
          signal: controller.signal,
          headers: {
            Accept: 'image/png,image/jpeg,image/webp',
            'Accept-Encoding': 'identity',
            'User-Agent': 'QingzhengPersonaMarket/1.0',
          },
          lookup: (_hostname, options, callback) =>
            options.all
              ? callback(null, [{ address: selected.address, family: selected.family }])
              : callback(null, selected.address, selected.family),
        },
        (response) => {
          if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
            response.destroy();
            cleanup();
            if (!response.headers.location) {
              reject(invalid());
              return;
            }
            resolve({ location: response.headers.location });
            return;
          }
          if (
            response.statusCode !== 200 ||
            (response.headers['content-encoding'] &&
              response.headers['content-encoding'] !== 'identity') ||
            Number(response.headers['content-length'] ?? 0) > maximum
          ) {
            response.destroy();
            cleanup();
            reject(invalid());
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maximum) {
              response.destroy(invalid());
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            cleanup();
            resolve({ bytes: Buffer.concat(chunks) });
          });
          response.on('error', (cause) => {
            cleanup();
            reject(cause);
          });
        },
      );
      req.on('socket', (socket) =>
        socket.once('secureConnect', () => {
          if (
            socket.remoteAddress !== selected.address ||
            !publicImageAddress(socket.remoteAddress)
          ) {
            req.destroy(invalid());
          }
        }),
      );
      req.on('error', (cause) => {
        cleanup();
        reject(cause);
      });
      req.end();
    });
    if (result.bytes) {
      await options.checkTarget?.(target);
      return result.bytes;
    }
    if (!result.location || redirect === 3) throw invalid();
    target = checkedImageUrl(new URL(result.location, target).href);
  }
  throw invalid();
}
