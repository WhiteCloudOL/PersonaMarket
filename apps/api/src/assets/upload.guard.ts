import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service.js';
@Injectable()
export class UploadGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const actor = await this.auth.identity(context.switchToHttp().getRequest<Request>());
    await this.auth.rate.take('asset-upload', actor.account.id, 20, 900);
    return true;
  }
}
