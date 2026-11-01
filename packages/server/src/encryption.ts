import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function sealSecret(key: string, purpose: string, text: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), nonce);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [
    'v1',
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}
export function openSecret(key: string, purpose: string, envelope: string): string {
  const [version, nonce, tag, ciphertext, extra] = envelope.split('.');
  if (version !== 'v1' || !nonce || !tag || !ciphertext || extra || envelope.length > 65536)
    throw new Error('INVALID_ENCRYPTED_SECRET');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(nonce, 'base64url'),
  );
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
