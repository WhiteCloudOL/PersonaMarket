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
  MediaSettingsResponseSchema,
  MediaSettingsWriteSchema,
  MediaSettingsRecordsQuerySchema,
  MediaSettingsRecordsResponseSchema,
  PublicMediaSettingsResponseSchema,
  ErrorResponseSchema,
  mediaSettingsEtag,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { MediaSettingsService } from './media-settings.service.js';

@Controller('settings/media')
@ApiTags('settings-media')
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class PublicMediaSettingsController {
  constructor(@Inject(MediaSettingsService) readonly service: MediaSettingsService) {}
  @Get()
  @ApiOperation({ operationId: 'getPublicMediaSettings' })
  @ApiOkResponse({ standardSchema: PublicMediaSettingsResponseSchema })
  @SerializeOptions({ schema: PublicMediaSettingsResponseSchema })
  read(@Req() request: Request) {
    return this.service.publicRead(request);
  }
}

@Controller('admin/settings/media')
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
export class MediaSettingsController {
  constructor(@Inject(MediaSettingsService) readonly service: MediaSettingsService) {}
  private async reply(response: Response, result: ReturnType<MediaSettingsService['read']>) {
    const body = await result;
    response.setHeader('ETag', mediaSettingsEtag(body.meta.revision));
    return body;
  }
  @Get()
  @ApiOperation({ operationId: 'getMediaSettings' })
  @ApiOkResponse({ standardSchema: MediaSettingsResponseSchema })
  @SerializeOptions({ schema: MediaSettingsResponseSchema })
  read(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.reply(response, this.service.read(request));
  }
  @Get('records')
  @ApiOperation({ operationId: 'getMediaSettingsRecords' })
  @ApiOkResponse({ standardSchema: MediaSettingsRecordsResponseSchema })
  @SerializeOptions({ schema: MediaSettingsRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Query({ schema: MediaSettingsRecordsQuerySchema })
    input: z.infer<typeof MediaSettingsRecordsQuerySchema>,
  ) {
    return this.service.records(request, input);
  }
  @Patch()
  @ApiOperation({ operationId: 'updateMediaSettings' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: MediaSettingsResponseSchema })
  @SerializeOptions({ schema: MediaSettingsResponseSchema })
  update(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: MediaSettingsWriteSchema })
    input: z.infer<typeof MediaSettingsWriteSchema>,
  ) {
    return this.reply(response, this.service.update(request, response, input));
  }
}
