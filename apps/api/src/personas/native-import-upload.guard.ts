import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { NativeImportFileQuerySchema } from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { ImportsService } from './imports.service.js';

/** 在Multer分配内存前完成身份/账号限流和格式校验，复用旧预览入口的同一账号预算 */
@Injectable()
export class NativeImportUploadGuard implements CanActivate {
  constructor(@Inject(ImportsService) readonly service: ImportsService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    await this.service.authorizePreview(request);
    if (!NativeImportFileQuerySchema.safeParse(request.query).success)
      throw new BusinessError('INVALID_INPUT', '请选择支持的原生文件格式与编码');
    return true;
  }
}
