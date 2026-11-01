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
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  TransferSettingsResponseSchema,
  TransferSettingsWriteSchema,
  TransferSettingsRecordsQuerySchema,
  TransferSettingsRecordsResponseSchema,
  PublicTransferSettingsResponseSchema,
  ErrorResponseSchema,
  transferSettingsEtag,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { TransferSettingsService } from './transfer-settings.service.js';

@Controller('settings/transfer')
@ApiTags('settings-transfer')
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class PublicTransferSettingsController {
  constructor(@Inject(TransferSettingsService) readonly service: TransferSettingsService) {}
  @Get()
  @ApiOperation({ operationId: 'getPublicTransferSettings' })
  @ApiOkResponse({ standardSchema: PublicTransferSettingsResponseSchema })
  @SerializeOptions({ schema: PublicTransferSettingsResponseSchema })
  read(@Req() request: Request) {
    return this.service.publicRead(request);
  }
}

@Controller('admin/settings/transfer')
@UseGuards(AuthGuard)
@ApiTags('settings')
@ApiHeader({
  name: 'X-Expected-Account',
  required: false,
  description: '仅核对实际账号，不授予权限',
})
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class TransferSettingsController {
  constructor(@Inject(TransferSettingsService) readonly service: TransferSettingsService) {}
  private async reply(response: Response, result: ReturnType<TransferSettingsService['read']>) {
    const body = await result;
    response.setHeader('ETag', transferSettingsEtag(body.meta.revision));
    return body;
  }
  @Get()
  @ApiOperation({ operationId: 'getTransferSettings' })
  @ApiOkResponse({ standardSchema: TransferSettingsResponseSchema })
  @SerializeOptions({ schema: TransferSettingsResponseSchema })
  read(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.reply(response, this.service.read(request));
  }
  @Get('records')
  @ApiOperation({ operationId: 'getTransferSettingsRecords' })
  @ApiOkResponse({ standardSchema: TransferSettingsRecordsResponseSchema })
  @SerializeOptions({ schema: TransferSettingsRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Query({ schema: TransferSettingsRecordsQuerySchema })
    input: z.infer<typeof TransferSettingsRecordsQuerySchema>,
  ) {
    return this.service.records(request, input);
  }
  @Patch()
  @ApiOperation({ operationId: 'updateTransferSettings' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: TransferSettingsResponseSchema })
  @SerializeOptions({ schema: TransferSettingsResponseSchema })
  update(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: TransferSettingsWriteSchema })
    input: z.infer<typeof TransferSettingsWriteSchema>,
  ) {
    return this.reply(response, this.service.update(request, response, input));
  }
}
