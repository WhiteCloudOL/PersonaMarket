import {
  changeOwnPassword,
  requestOwnEmailChange,
  confirmOwnEmailChange,
  confirmOwnEmailChangeCode,
  getOwnDeactivationRequest,
  requestOwnDeactivation,
  withdrawOwnDeactivation,
} from '@personamarket/api-client';
import {
  AuthNoticeResponseSchema,
  DeactivationResponseSchema,
  type ChangePasswordRequestSchema,
  type ChangeEmailRequestSchema,
  type ConfirmEmailChangeCodeSchema,
  type DeactivationRequestSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import { authenticatedWrite, checkedResponse, sessionRequestOptions } from './auth-api';
const options = () => ({ ...sessionRequestOptions, signal: AbortSignal.timeout(10000) });
export const securityApi = {
  password: (body: z.infer<typeof ChangePasswordRequestSchema>) =>
    authenticatedWrite(
      (header) => changeOwnPassword({ ...options(), body, params: { header } }),
      AuthNoticeResponseSchema,
    ),
  email: (body: z.infer<typeof ChangeEmailRequestSchema>) =>
    authenticatedWrite(
      (header) => requestOwnEmailChange({ ...options(), body, params: { header } }),
      AuthNoticeResponseSchema,
    ),
  confirmEmail: (token: string) =>
    authenticatedWrite(
      (header) => confirmOwnEmailChange({ ...options(), body: { token }, params: { header } }),
      AuthNoticeResponseSchema,
    ),
  confirmEmailCode: (body: z.infer<typeof ConfirmEmailChangeCodeSchema>) =>
    authenticatedWrite(
      (header) => confirmOwnEmailChangeCode({ ...options(), body, params: { header } }),
      AuthNoticeResponseSchema,
    ),
  deactivation: async () =>
    checkedResponse(await getOwnDeactivationRequest(options()), DeactivationResponseSchema),
  requestDeactivation: (body: z.infer<typeof DeactivationRequestSchema>) =>
    authenticatedWrite(
      (header) => requestOwnDeactivation({ ...options(), body, params: { header } }),
      AuthNoticeResponseSchema,
    ),
  withdraw: () =>
    authenticatedWrite(
      (header) => withdrawOwnDeactivation({ ...options(), params: { header } }),
      AuthNoticeResponseSchema,
    ),
};
