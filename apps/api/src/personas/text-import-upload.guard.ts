import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { TextImportFileQuerySchema } from '@personamarket/contracts';
import { BusinessError } from '@personamarket/server';
import { ImportsService } from './imports.service.js';

@Injectable()
export class TextImportUploadGuard implements CanActivate {
  constructor(@Inject(ImportsService) readonly service: ImportsService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    await this.service.authorizeTextSource(request);
    if (!TextImportFileQuerySchema.safeParse(request.query).success)
      throw new BusinessError('INVALID_INPUT', '请选择纯文本或 Markdown 及支持的编码');
    return true;
  }
}
