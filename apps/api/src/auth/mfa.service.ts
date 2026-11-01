import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  BusinessError,
  hashAuthSecret,
  issueAuthSecret,
  openSecret,
  sealSecret,
} from '@personamarket/server';
import { createTotp, generateMfaSecret, mfaQrCode } from '@personamarket/server';
import { AuthService } from './auth.service.js';
import { requireRecentVerification } from './verification-policy.js';

@Injectable()
export class MfaService {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async setup(request: Request) {
    const identity = await this.auth.identity(request, false);
    requireRecentVerification(identity, true);
    await this.auth.rate.take('mfa-setup', identity.account.id, 5, 900);
    const secret = generateMfaSecret();
    await this.auth.repository.prepareMfa(
      identity.account.id,
      sealSecret(this.auth.env.APP_ENCRYPTION_KEY, `mfa:${identity.account.id}`, secret),
    );
    const otp = createTotp(secret, identity.account.username);
    const uri = otp.toString();
    return { data: { secret, uri, qrDataUrl: await mfaQrCode(uri) } };
  }
  async verify(code: string, confirm: boolean, request: Request, response: Response) {
    const identity = await this.auth.identity(request, false);
    await this.auth.rate.take('mfa-verify', identity.account.id, 5, 300);
    const mfa = await this.auth.repository.mfa(identity.account.id);
    if (
      !mfa ||
      (confirm ? Boolean(mfa.confirmedAt) || mfa.pendingExpiresAt <= new Date() : !mfa.confirmedAt)
    )
      throw new BusinessError('INVALID_INPUT', '二次验证设置已失效，请重新开始');
    const secret = openSecret(
      this.auth.env.APP_ENCRYPTION_KEY,
      `mfa:${identity.account.id}`,
      mfa.encryptedSecret,
    );
    const otp = createTotp(secret, identity.account.username);
    const timestamp = Date.now();
    const delta = code.length === 6 ? otp.validate({ token: code, window: 1, timestamp }) : null;
    const recoveryHash =
      !confirm && code.length !== 6 ? hashAuthSecret('mfa_recovery', code) : undefined;
    if (delta === null && !recoveryHash)
      throw new BusinessError('INVALID_INPUT', '验证码无效或已使用');
    const codes = confirm ? Array.from({ length: 10 }, () => issueAuthSecret('mfa_recovery')) : [];
    const issue = this.auth.issue(request);
    const proof: { counter?: number; recoveryHash?: string } = {};
    if (delta !== null) proof.counter = Math.floor(timestamp / 30000) + delta;
    else if (recoveryHash) proof.recoveryHash = recoveryHash;
    const result = await this.auth.repository.finishMfa(
      identity,
      mfa.encryptedSecret,
      proof,
      confirm,
      issue.record,
      this.auth.requestId(response),
      codes.map((item) => item.hash),
    );
    this.auth.applySession(response, issue, result.session.expiresAt);
    return confirm
      ? { data: { recoveryCodes: codes.map((item) => item.token) } }
      : { data: { message: '二次验证成功' } };
  }
}
