import { TOTP, Secret } from 'otpauth';
import QRCode from 'qrcode';
export function generateMfaSecret() {
  return new Secret({ size: 20 }).base32;
}
export function createTotp(secret: string, label: string) {
  return new TOTP({ issuer: '清蒸云鸭', label, secret, algorithm: 'SHA1', digits: 6, period: 30 });
}
export function mfaQrCode(uri: string) {
  return QRCode.toDataURL(uri, { width: 240, margin: 2 });
}
