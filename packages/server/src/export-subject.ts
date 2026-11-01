import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 每个UTC日更换匿名标识，不采集IP/UA；签名只防篡改，不宣称能阻止清Cookie刷量 */
export function exportSubject(
  key: string,
  cookie: string | undefined,
  accountId?: string,
  now = Date.now(),
) {
  const day = new Date(now).toISOString().slice(0, 10);
  const sign = (purpose: string, value: string) =>
    createHmac('sha256', Buffer.from(key, 'hex'))
      .update(`${purpose}\0${day}\0${value}`)
      .digest('hex');
  const match = cookie && /^(\d{4}-\d{2}-\d{2})\.([a-f0-9]{48})\.([a-f0-9]{64})$/.exec(cookie);
  const nonce =
    match &&
    match[1] === day &&
    match[2] &&
    match[3] &&
    timingSafeEqual(
      Buffer.from(match[3], 'hex'),
      Buffer.from(sign('export-cookie', match[2]), 'hex'),
    )
      ? match[2]
      : randomBytes(24).toString('hex');
  return {
    day,
    hash: sign('export-subject', accountId ? 'account:' + accountId : 'anonymous:' + nonce),
    cookie: `${day}.${nonce}.${sign('export-cookie', nonce)}`,
    maxAge: Date.parse(day + 'T00:00:00Z') + 86400_000 - now,
  };
}
