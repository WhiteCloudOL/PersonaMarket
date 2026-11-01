import { isIP } from 'node:net';

/** 仅在受控单跳代理部署中接受单个IP，不转发Cookie、身份或客户端自带的代理链 */
export function trustedPublicHeaders(
  trustProxy: unknown,
  address: unknown,
): Record<string, string> {
  if (trustProxy !== '1' || typeof address !== 'string' || address.length > 45 || !isIP(address))
    return {};
  return { 'x-forwarded-for': address };
}
