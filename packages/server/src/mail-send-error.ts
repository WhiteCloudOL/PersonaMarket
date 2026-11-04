import { z } from 'zod';

export class MailSendError extends Error {
  constructor(
    readonly code:
      | 'MAIL_SEND_FAILED'
      | 'MAIL_RESULT_UNCERTAIN'
      | 'MAIL_NOT_CONFIGURED'
      | 'MAIL_RECIPIENT_REJECTED',
    readonly sideEffect: 'none' | 'unknown',
    options?: ErrorOptions,
  ) {
    super(code, options);
  }
}
const smtpErrorSchema = z.object({
  code: z.string().optional(),
  originalCode: z.string().optional(),
  command: z.string().optional(),
  responseCode: z.number().int().optional(),
  timeoutType: z.string().optional(),
});
export function smtpRecipientRejected(cause: unknown) {
  const parsed = smtpErrorSchema.safeParse(cause);
  return (
    parsed.success &&
    parsed.data.command === 'RCPT TO' &&
    parsed.data.responseCode !== undefined &&
    parsed.data.responseCode >= 500 &&
    parsed.data.responseCode < 600
  );
}
/** CONN也可能是DATA之后断线，不能仅凭command将不确定发送判为安全重试 */
export function smtpDefinitelyNotAccepted(cause: unknown) {
  const parsed = smtpErrorSchema.safeParse(cause);
  if (!parsed.success) return false;
  const error = parsed.data;
  if (
    [
      'EDNS',
      'EAUTH',
      'ENOAUTH',
      'EOAUTH2',
      'ECONFIG',
      'EENVELOPE',
      'EMAXRECIPIENTS',
      'EREQUIRETLS',
      'EOTP',
    ].includes(error.code ?? '')
  )
    return true;
  if (error.originalCode === 'ECONNREFUSED') return true;
  if (
    error.code === 'ETIMEDOUT' &&
    ['CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT'].includes(error.timeoutType ?? '')
  )
    return true;
  return Boolean(
    error.responseCode &&
    error.responseCode >= 400 &&
    error.responseCode < 600 &&
    ['MAIL FROM', 'RCPT TO', 'DATA'].includes(error.command ?? ''),
  );
}
