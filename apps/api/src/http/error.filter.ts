import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { ErrorResponseSchema, type ErrorCode } from '@personamarket/contracts';
import { BusinessError, errorStatus, type AppLogger } from '@personamarket/server';
import type { Response } from 'express';

const messages: Partial<Record<number, { code: ErrorCode; message: string }>> = {
  400: { code: 'INVALID_INPUT', message: '请求格式不正确' },
  401: { code: 'UNAUTHENTICATED', message: '请先登录' },
  403: { code: 'FORBIDDEN', message: '无权执行此操作' },
  404: { code: 'NOT_FOUND', message: '资源不存在或不可访问' },
  413: { code: 'INVALID_INPUT', message: '请求内容过大，请缩小文件或内容后重试' },
  429: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' },
  503: { code: 'SERVICE_UNAVAILABLE', message: '服务正在恢复，请稍后重试' },
};

function databaseRestarting(exception: unknown) {
  let current = exception;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if ('code' in current && ['57P01', '57P02', '57P03'].includes(String(current.code)))
      return true;
    current = current.cause;
  }
  return false;
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof BusinessError
        ? errorStatus[exception.code]
        : exception instanceof HttpException
          ? exception.getStatus()
          : databaseRestarting(exception)
            ? 503
            : 500;
    const safe =
      exception instanceof BusinessError
        ? { code: exception.code, message: exception.message }
        : (messages[status] ?? { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请稍后重试' });
    const requestId: unknown = response.locals['requestId'];
    const body = ErrorResponseSchema.parse({
      error: {
        ...safe,
        fieldErrors: exception instanceof BusinessError ? exception.fieldErrors : [],
        requestId,
      },
    });
    const retryAfter = exception instanceof BusinessError ? exception.retryAfterSeconds : undefined;
    if (retryAfter || status === 503) response.setHeader('Retry-After', String(retryAfter ?? 1));
    this.logger[status >= 500 ? 'error' : 'warn']({
      event: 'http.error',
      requestId,
      code: safe.code,
      status,
    });
    response.status(status).json(body);
  }
}
