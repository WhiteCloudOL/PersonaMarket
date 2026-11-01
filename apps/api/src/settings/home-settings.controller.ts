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
  HomeSettingsResponseSchema,
  HomeSettingsWriteSchema,
  HomeSettingsRecordsQuerySchema,
  HomeSettingsRecordsResponseSchema,
  PublicHomeSettingsResponseSchema,
  ErrorResponseSchema,
  homeSettingsEtag,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { HomeSettingsService } from './home-settings.service.js';

@Controller('site/home')
@ApiTags('site-home')
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class PublicHomeSettingsController {
  constructor(@Inject(HomeSettingsService) readonly service: HomeSettingsService) {}
  @Get()
  @ApiOperation({ operationId: 'getPublicHomeSettings' })
  @ApiOkResponse({ standardSchema: PublicHomeSettingsResponseSchema })
  @SerializeOptions({ schema: PublicHomeSettingsResponseSchema })
  read(@Req() request: Request) {
    return this.service.publicRead(request);
  }
}

@Controller('admin/settings/home')
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
export class HomeSettingsController {
  constructor(@Inject(HomeSettingsService) readonly service: HomeSettingsService) {}
  private async reply(response: Response, result: ReturnType<HomeSettingsService['read']>) {
    const body = await result;
    response.setHeader('ETag', homeSettingsEtag(body.meta.revision));
    return body;
  }
  @Get()
  @ApiOperation({ operationId: 'getHomeSettings' })
  @ApiOkResponse({ standardSchema: HomeSettingsResponseSchema })
  @SerializeOptions({ schema: HomeSettingsResponseSchema })
  read(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.reply(response, this.service.read(request));
  }
  @Get('records')
  @ApiOperation({ operationId: 'getHomeSettingsRecords' })
  @ApiOkResponse({ standardSchema: HomeSettingsRecordsResponseSchema })
  @SerializeOptions({ schema: HomeSettingsRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Query({ schema: HomeSettingsRecordsQuerySchema })
    input: z.infer<typeof HomeSettingsRecordsQuerySchema>,
  ) {
    return this.service.records(request, input);
  }
  @Patch()
  @ApiOperation({ operationId: 'updateHomeSettings' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: HomeSettingsResponseSchema })
  @SerializeOptions({ schema: HomeSettingsResponseSchema })
  update(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: HomeSettingsWriteSchema }) input: z.infer<typeof HomeSettingsWriteSchema>,
  ) {
    return this.reply(response, this.service.update(request, response, input));
  }
}
