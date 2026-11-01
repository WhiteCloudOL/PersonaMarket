import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  EmptySettingsRequestSchema,
  ErrorResponseSchema,
  MailSettingsResponseSchema,
  MailTestResponseSchema,
  UpdateMailSettingsSchema,
} from '@personamarket/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { SettingsService } from './settings.service.js';
@ApiTags('admin-settings')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
@UseGuards(AuthGuard)
@Controller('admin/settings')
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly service: SettingsService) {}
  @Get('mail')
  @ApiOperation({ operationId: 'getMailSettings', summary: '读取脱敏邮件设置' })
  @ApiOkResponse({ standardSchema: MailSettingsResponseSchema })
  @SerializeOptions({ schema: MailSettingsResponseSchema })
  async mail(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.service.readMail(request);
    response.setHeader('ETag', '"mail-' + result.meta.revision + '"');
    return result;
  }
  @Patch('mail')
  @ApiOperation({ operationId: 'updateMailSettings', summary: '加密更新邮件设置' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ standardSchema: MailSettingsResponseSchema })
  @SerializeOptions({ schema: MailSettingsResponseSchema })
  async updateMail(
    @Body({ schema: UpdateMailSettingsSchema }) input: z.infer<typeof UpdateMailSettingsSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.updateMail(input, request, response);
    response.setHeader('ETag', '"mail-' + result.meta.revision + '"');
    return result;
  }
  @Post('mail/test')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'sendMailSettingsTest',
    summary: '向当前管理员已验证邮箱发送测试邮件',
  })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: MailTestResponseSchema })
  @SerializeOptions({ schema: MailTestResponseSchema })
  testMail(
    @Body({ schema: EmptySettingsRequestSchema })
    _input: z.infer<typeof EmptySettingsRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.service.testMail(request, response);
  }
}
