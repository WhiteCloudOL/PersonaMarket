import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { OpaqueAuthTokenSchema } from '@personamarket/contracts';
import { BusinessError, issueAuthSecret, type ServerEnvironment } from '@personamarket/server';

export function cookieName(env: ServerEnvironment, purpose: 'session' | 'csrf') {
  return `${env.NODE_ENV === 'production' ? '__Host-' : ''}pm-${purpose}`;
}
export function readCookie(request: Request, name: string): string | undefined {
  const matches = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(name + '='));
  if (matches.length !== 1) return undefined;
  const token = matches[0]?.slice(name.length + 1);
  return OpaqueAuthTokenSchema.safeParse(token).success ? token : undefined;
}
export function csrfHeader(env: ServerEnvironment, seed: string, session = '') {
  return createHmac('sha256', Buffer.from(env.APP_ENCRYPTION_KEY, 'hex'))
    .update(`csrf-header\0${seed}\0${session}`)
    .digest('hex');
}
export function setAuthCookie(
  env: ServerEnvironment,
  response: Response,
  purpose: 'session' | 'csrf',
  value: string,
  maxAge: number,
) {
  response.cookie(cookieName(env, purpose), value, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: purpose === 'csrf' ? 'strict' : 'lax',
    path: '/',
    maxAge,
  });
}
export function ensureCsrf(
  env: ServerEnvironment,
  request: Request,
  response: Response,
  rotate = false,
) {
  const seed =
    (!rotate && readCookie(request, cookieName(env, 'csrf'))) || issueAuthSecret('csrf').token;
  setAuthCookie(env, response, 'csrf', seed, 86400_000);
  return csrfHeader(env, seed, readCookie(request, cookieName(env, 'session')));
}
export function assertCsrf(env: ServerEnvironment, request: Request) {
  const origin = request.get('origin');
  const seed = readCookie(request, cookieName(env, 'csrf'));
  const header = request.get('x-csrf-token');
  if (
    origin !== new URL(env.PUBLIC_ORIGIN).origin ||
    request.get('sec-fetch-site') === 'cross-site' ||
    !seed ||
    !header ||
    !/^[0-9a-f]{64}$/.test(header) ||
    !timingSafeEqual(
      Buffer.from(header, 'hex'),
      Buffer.from(csrfHeader(env, seed, readCookie(request, cookieName(env, 'session'))), 'hex'),
    )
  )
    throw new BusinessError('FORBIDDEN', '请求校验失败，请刷新页面后重试');
}
