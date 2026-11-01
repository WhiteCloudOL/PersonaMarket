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
import { ApiHeader, ApiOperation, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CreationSettingsResponseSchema,
  CreationSettingsUpdateSchema,
  SubmissionSettingsRecordsQuerySchema,
  SubmissionSettingsRecordsResponseSchema,
  ErrorResponseSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CreationSettingsService } from './creation-settings.service.js';
@ApiTags('settings')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
@ApiHeader({
  name: 'X-Expected-Account',
  required: false,
  description: '仅核对实际账号，不授予权限',
})
@UseGuards(AuthGuard)
@Controller('admin/settings/creation')
export class CreationSettingsController {
  constructor(@Inject(CreationSettingsService) readonly service: CreationSettingsService) {}
  @Get()
  @ApiOperation({ operationId: 'getCreationSettings' })
  @ApiOkResponse({ standardSchema: CreationSettingsResponseSchema })
  @SerializeOptions({ schema: CreationSettingsResponseSchema })
  read(@Req() request: Request) {
    return this.service.read(request);
  }
  @Get('records')
  @ApiOperation({ operationId: 'getSubmissionSettingsRecords' })
  @ApiOkResponse({ standardSchema: SubmissionSettingsRecordsResponseSchema })
  @SerializeOptions({ schema: SubmissionSettingsRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Query({ schema: SubmissionSettingsRecordsQuerySchema })
    input: z.infer<typeof SubmissionSettingsRecordsQuerySchema>,
  ) {
    return this.service.records(request, input);
  }
  @Patch()
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: '新客户端保存及核对原请求时复用；旧客户端沿用双修订CAS',
  })
  @ApiOperation({ operationId: 'updateCreationSettings' })
  @ApiOkResponse({ standardSchema: CreationSettingsResponseSchema })
  @SerializeOptions({ schema: CreationSettingsResponseSchema })
  update(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: CreationSettingsUpdateSchema })
    input: z.infer<typeof CreationSettingsUpdateSchema>,
  ) {
    return this.service.update(request, response, input);
  }
}
