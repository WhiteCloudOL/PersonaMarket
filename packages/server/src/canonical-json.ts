import { createHash } from 'node:crypto';
import { canonicalJson } from '@personamarket/contracts';
export { canonicalJson };
export const contentHash = (value: unknown) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
