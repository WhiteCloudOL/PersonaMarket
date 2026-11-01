import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ServerEnvironment } from '@personamarket/server';
import { ENVIRONMENT } from '../tokens.js';
import { assertCsrf } from './cookie-security.js';
import { AuthRateLimit } from './rate-limit.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(ENVIRONMENT) private readonly env: ServerEnvironment,
    @Inject(AuthRateLimit) private readonly rate: AuthRateLimit,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD'].includes(request.method)) return true;
    assertCsrf(this.env, request);
    await this.rate.take('write-ip', request.ip ?? 'unknown', 60, 300);
    return true;
  }
}
