import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Query,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AccountSettingsUpdateSchema,
  AccountSettingsResponseSchema,
  AccountSettingsRecordsQuerySchema,
  AccountSettingsRecordsResponseSchema,
  ErrorResponseSchema,
  accountSettingsEtag,
} from '@personamarket/contracts';
import type { z } from 'zod';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { AccountSettingsService } from './account-settings.service.js';

@Controller('admin/settings/accounts')
@UseGuards(AuthGuard)
@ApiTags('account-settings')
@ApiHeader({
  name: 'X-Expected-Account',
  required: false,
  description: '核对当前实际账号，不授予权限',
})
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class AccountSettingsController {
  constructor(@Inject(AccountSettingsService) readonly service: AccountSettingsService) {}
  @Get()
  @ApiOperation({
    operationId: 'getAccountSettings',
    summary: '读取注册、验证邮件时机、限流和新会话期限',
  })
  @ApiOkResponse({ standardSchema: AccountSettingsResponseSchema })
  @SerializeOptions({ schema: AccountSettingsResponseSchema })
  async read(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.service.read(request);
    response.setHeader('ETag', accountSettingsEtag(result.meta.revision));
    return result;
  }
  @Get('records')
  @ApiOperation({
    operationId: 'getAccountSettingsRecords',
    summary: '分页读取只读账户策略差异记录',
  })
  @ApiOkResponse({ standardSchema: AccountSettingsRecordsResponseSchema })
  @SerializeOptions({ schema: AccountSettingsRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Query({ schema: AccountSettingsRecordsQuerySchema })
    input: z.infer<typeof AccountSettingsRecordsQuerySchema>,
  ) {
    return this.service.records(request, input);
  }
  @Patch()
  @ApiOperation({
    operationId: 'updateAccountSettings',
    summary: '近期身份确认后原子更新注册与账户策略',
  })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: '新客户端使用UUID供未知结果显式核对；旧载荷可省略',
  })
  @ApiOkResponse({ standardSchema: AccountSettingsResponseSchema })
  @SerializeOptions({ schema: AccountSettingsResponseSchema })
  async update(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: AccountSettingsUpdateSchema })
    input: z.infer<typeof AccountSettingsUpdateSchema>,
  ) {
    const result = await this.service.update(request, response, input);
    response.setHeader('ETag', accountSettingsEtag(result.meta.revision));
    return result;
  }
}
