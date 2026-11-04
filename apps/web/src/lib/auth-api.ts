import * as api from '@personamarket/api-client';
import {
  AuthContextResponseSchema,
  AuthNoticeResponseSchema,
  AuthSessionsResponseSchema,
  ErrorResponseSchema,
  MfaConfirmResponseSchema,
  MfaSetupResponseSchema,
  PublicConfigResponseSchema,
  LoginResponseSchema,
  type RegisterRequestSchema,
  type LoginRequestSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { requestAuthSessionRefresh } from './auth-session-events';

type Result = { data?: unknown; error?: unknown; response: Response };
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly fieldErrors: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
function checked<T>(result: Result, schema: z.ZodType<T>): T {
  if (!result.response.ok || result.error) {
    const error = ErrorResponseSchema.safeParse(result.error);
    if (error.success)
      throw new ApiError(
        error.data.error.message,
        error.data.error.code,
        error.data.error.fieldErrors,
      );
    throw new Error('请求暂时无法完成，请稍后重试');
  }
  return schema.parse(result.data);
}
export async function readAuthContext() {
  return checked(
    await api.getAuthContext({
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(8000),
    }),
    AuthContextResponseSchema,
  );
}
async function write<T>(
  send: (header: { 'X-CSRF-Token': string }) => Promise<Result>,
  schema: z.ZodType<T>,
) {
  const context = await readAuthContext();
  return checked(await send({ 'X-CSRF-Token': context.data.csrfToken }), schema);
}
const request = { cache: 'no-store', credentials: 'same-origin', signal: undefined } as const;
/** 私有文件与长表单在读取新CSRF之后再核对实际账号，避免跨窗口换号时发送旧输入 */
export async function authenticatedWriteFor<T>(
  accountId: string,
  send: (header: { 'X-CSRF-Token': string }) => Promise<Result>,
  schema: z.ZodType<T>,
  messages?: { accountChanged: string; verificationRequired: string },
) {
  const context = await readAuthContext();
  if (!context.data.account) {
    requestAuthSessionRefresh();
    throw new ApiError(
      '登录已过期，请在新窗口重新登录后继续，当前输入会保留',
      'UNAUTHENTICATED',
      [],
    );
  }
  if (context.data.account?.id !== accountId) {
    requestAuthSessionRefresh();
    throw new ApiError(
      messages?.accountChanged ?? '登录账号已变化，请重新选择要导入的文件',
      'CONFLICT',
      [],
    );
  }
  if (context.data.assurance !== 'authenticated') {
    requestAuthSessionRefresh();
    throw new ApiError(
      messages?.verificationRequired ?? '请先完成登录验证，再继续导入',
      'UNAUTHENTICATED',
      [],
    );
  }
  return checked(await send({ 'X-CSRF-Token': context.data.csrfToken }), schema);
}
export {
  checked as checkedResponse,
  write as authenticatedWrite,
  request as sessionRequestOptions,
};
export const authApi = {
  reauthenticate: (currentPassword: string) =>
    write(
      (header) =>
        api.reauthenticateAccount({
          ...request,
          body: { currentPassword },
          params: { header },
          signal: AbortSignal.timeout(10000),
        }),
      AuthNoticeResponseSchema,
    ),
  register: (body: z.infer<typeof RegisterRequestSchema>) =>
    write(
      (header) =>
        api.registerAccount({
          ...request,
          body,
          params: { header },
          signal: AbortSignal.timeout(10000),
        }),
      AuthNoticeResponseSchema,
    ),
  login: (body: z.infer<typeof LoginRequestSchema>) =>
    write(
      (header) =>
        api.loginAccount({
          ...request,
          body,
          params: { header },
          signal: AbortSignal.timeout(10000),
        }),
      LoginResponseSchema,
    ),
  verify: (token: string) =>
    write(
      (header) =>
        api.verifyEmail({
          ...request,
          body: { token },
          params: { header },
          signal: AbortSignal.timeout(10000),
        }),
      AuthNoticeResponseSchema,
    ),
  resend: (email: string) =>
    write(
      (header) =>
        api.resendVerification({
          ...request,
          body: { email },
          params: { header },
          signal: AbortSignal.timeout(10000),
        }),
      AuthNoticeResponseSchema,
    ),
  forgot: (email: string) =>
    write(
      (header) =>
        api.forgotPassword({
          ...request,
          body: { email },
          params: { header },
          signal: AbortSignal.timeout(10000),
        }),
      AuthNoticeResponseSchema,
    ),
  reset: (body: { token: string; password: string }) =>
    write(
      (header) =>
        api.resetPassword({
          ...request,
          body,
          params: { header },
          signal: AbortSignal.timeout(10000),
        }),
      AuthNoticeResponseSchema,
    ),
  logout: () =>
    write(
      (header) =>
        api.logoutAccount({ ...request, params: { header }, signal: AbortSignal.timeout(8000) }),
      AuthNoticeResponseSchema,
    ),
  logoutAll: () =>
    write(
      (header) =>
        api.logoutAllSessions({
          ...request,
          params: { header },
          signal: AbortSignal.timeout(8000),
        }),
      AuthNoticeResponseSchema,
    ),
  revoke: (id: string) =>
    write(
      (header) =>
        api.revokeAuthSession({
          ...request,
          params: { header, path: { id } },
          signal: AbortSignal.timeout(8000),
        }),
      AuthNoticeResponseSchema,
    ),
  sessions: async () =>
    checked(
      await api.listAuthSessions({ ...request, signal: AbortSignal.timeout(8000) }),
      AuthSessionsResponseSchema,
    ),
  setup: () =>
    write(
      (header) =>
        api.setupMfa({ ...request, params: { header }, signal: AbortSignal.timeout(8000) }),
      MfaSetupResponseSchema,
    ),
  confirm: (code: string) =>
    write(
      (header) =>
        api.confirmMfa({
          ...request,
          body: { code },
          params: { header },
          signal: AbortSignal.timeout(8000),
        }),
      MfaConfirmResponseSchema,
    ),
  mfa: (code: string) =>
    write(
      (header) =>
        api.verifyMfa({
          ...request,
          body: { code },
          params: { header },
          signal: AbortSignal.timeout(8000),
        }),
      AuthNoticeResponseSchema,
    ),
  brand: async () =>
    checked(
      await api.getAdminBrand({ ...request, signal: AbortSignal.timeout(8000) }),
      PublicConfigResponseSchema,
    ),
  updateBrand: (body: z.infer<typeof PublicConfigResponseSchema>['data'], revision: number) =>
    write(
      (header) =>
        api.updateAdminBrand({
          ...request,
          body,
          params: { header: { ...header, 'If-Match': `"brand-${revision}"` } },
          signal: AbortSignal.timeout(8000),
        }),
      PublicConfigResponseSchema,
    ),
};
export const authQuery = {
  queryKey: ['auth-context'] as const,
  queryFn: readAuthContext,
  staleTime: 0,
  retry: false as const,
};
