import { RegistrationRateLimitSchema, type RegistrationRateLimit } from '@personamarket/contracts';

/** 仅窗口构成业务桶身份；改阈值/会话/邮件时机不重新获得空额度。 */
export function registrationRateScope(value: RegistrationRateLimit) {
  return 'registration-policy-ip:v1:w' + RegistrationRateLimitSchema.parse(value).windowSeconds;
}
