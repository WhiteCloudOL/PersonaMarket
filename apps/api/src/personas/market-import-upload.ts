import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
  type NestInterceptor,
  type CallHandler,
} from '@nestjs/common';
import type { Request } from 'express';
import { finalize } from 'rxjs';
import { BusinessError } from '@personamarket/server';
import { MarketImportFileQuerySchema } from '@personamarket/contracts';
import { AuthService } from '../auth/auth.service.js';

@Injectable()
export class MarketImportUploadGuard implements CanActivate {
  constructor(@Inject(AuthService) readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const actor = await this.auth.identity(request);
    await this.auth.rate.take('market-import-preview', actor.account.id, 20, 3600);
    if (!MarketImportFileQuerySchema.safeParse(request.query).success)
      throw new BusinessError('INVALID_INPUT', '请选择支持的文件编码');
    return true;
  }
}
/** 在Multer分配上传缓冲区之前限定单进程只有一个大包预览 */
@Injectable()
export class MarketImportUploadLease implements NestInterceptor<unknown, unknown> {
  private active = false;
  intercept(_context: ExecutionContext, next: CallHandler<unknown>) {
    if (this.active) throw new BusinessError('SERVICE_UNAVAILABLE', '已有文件正在预览，请稍后重试');
    this.active = true;
    try {
      return next.handle().pipe(
        finalize(() => {
          this.active = false;
        }),
      );
    } catch (cause) {
      this.active = false;
      throw cause;
    }
  }
}
