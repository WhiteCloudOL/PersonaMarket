import type { ErrorCode } from '@personamarket/contracts';

export class BusinessError extends Error {
  readonly retryAfterSeconds: number | undefined;
  readonly fieldErrors: Array<{ path: string; message: string }>;
  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: ErrorOptions & {
      retryAfterSeconds?: number;
      fieldErrors?: Array<{ path: string; message: string }>;
    },
  ) {
    super(message, options);
    this.name = 'BusinessError';
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.fieldErrors = options?.fieldErrors ?? [];
  }
}
export const errorStatus: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  MFA_REQUIRED: 403,
  REAUTH_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  REVISION_CONFLICT: 412,
  RATE_LIMITED: 429,
  MAINTENANCE_MODE: 503,
  SERVICE_UNAVAILABLE: 503,
  INVALID_RESPONSE: 500,
  INTERNAL_ERROR: 500,
  UNSUPPORTED_FORMAT: 422,
};
