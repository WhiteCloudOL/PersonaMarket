import commonPasswords from './data/common-passwords.json' with { type: 'json' };
import { BusinessError } from './errors.js';
const blocked = new Set(commonPasswords.map((value) => value.toLowerCase()));
/** 仅作完整口令比较，保留原始密码；不向第三方发送口令或其哈希。 */
export function assertNewPassword(password: string, account?: { username: string; email: string }) {
  const value = password.toLowerCase();
  const contextual = new Set(['personamarket', '清蒸云鸭·人设市场']);
  if (account) {
    const identities = [
      account.username.toLowerCase(),
      account.email.toLowerCase(),
      account.email.split('@')[0]?.toLowerCase() ?? '',
    ];
    for (const identity of identities)
      for (const suffix of ['', '123', '123456', '2026', '2027', '!'])
        contextual.add(identity + suffix);
  }
  if (
    blocked.has(value) ||
    contextual.has(value) ||
    /^(.)\1{11,}$/u.test(value) ||
    /^(?:0123456789|1234567890|qwertyuiop|password){2,}$/i.test(value)
  )
    throw new BusinessError('INVALID_INPUT', '这个密码容易被猜到，请使用更独特的长口令');
}
