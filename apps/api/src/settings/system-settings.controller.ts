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
  SystemSettingsWriteSchema,
  SystemSettingsResponseSchema,
  SystemSettingsRecordsQuerySchema,
  SystemSettingsRecordsResponseSchema,
  PublicSystemStatusResponseSchema,
  SystemRuntimeResponseSchema,
  ErrorResponseSchema,
  systemSettingsEtag,
  type SystemSettingsWrite,
  type SystemSettingsRecordsQuery,
} from '@personamarket/contracts';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { SystemSettingsService } from './system-settings.service.js';

@Controller('admin/settings/system')
@UseGuards(AuthGuard)
@ApiTags('system-settings')
@ApiHeader({ name: 'X-Expected-Account', required: false })
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class SystemSettingsController {
  constructor(@Inject(SystemSettingsService) readonly service: SystemSettingsService) {}
  @Get()
  @ApiOperation({ operationId: 'getSystemSettings', summary: '读取维护设置与当前修订' })
  @ApiOkResponse({ standardSchema: SystemSettingsResponseSchema })
  @SerializeOptions({ schema: SystemSettingsResponseSchema })
  async read(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.service.read(request);
    response.setHeader('ETag', systemSettingsEtag(result.meta.revision));
    return result;
  }
  @Get('records')
  @ApiOperation({ operationId: 'getSystemSettingsRecords', summary: '分页读取维护设置差异记录' })
  @ApiOkResponse({ standardSchema: SystemSettingsRecordsResponseSchema })
  @SerializeOptions({ schema: SystemSettingsRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Query({ schema: SystemSettingsRecordsQuerySchema }) input: SystemSettingsRecordsQuery,
  ) {
    return this.service.records(request, input);
  }
  @Get('runtime')
  @ApiOperation({ operationId: 'getSystemRuntime', summary: '读取API实际构建产物与Node版本' })
  @ApiOkResponse({ standardSchema: SystemRuntimeResponseSchema })
  @SerializeOptions({ schema: SystemRuntimeResponseSchema })
  runtime(@Req() request: Request) {
    return this.service.runtime(request);
  }
  @Patch()
  @ApiOperation({ operationId: 'updateSystemSettings', summary: '近期身份确认后原子更新维护设置' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: SystemSettingsResponseSchema })
  @SerializeOptions({ schema: SystemSettingsResponseSchema })
  async update(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: SystemSettingsWriteSchema }) input: SystemSettingsWrite,
  ) {
    const result = await this.service.update(request, response, input);
    response.setHeader('ETag', systemSettingsEtag(result.meta.revision));
    return result;
  }
}

@Controller('public/system-status')
@UseGuards(AuthGuard)
@ApiTags('system-settings')
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class PublicSystemStatusController {
  constructor(@Inject(SystemSettingsService) readonly service: SystemSettingsService) {}
  @Get()
  @ApiOperation({ operationId: 'getPublicSystemStatus', summary: '读取公开维护状态与纯文本提示' })
  @ApiOkResponse({ standardSchema: PublicSystemStatusResponseSchema })
  @SerializeOptions({ schema: PublicSystemStatusResponseSchema })
  read(@Req() request: Request) {
    return this.service.publicStatus(request);
  }
}
