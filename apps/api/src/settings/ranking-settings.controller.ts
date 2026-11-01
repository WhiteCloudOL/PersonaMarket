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
  RankingSettingsResponseSchema,
  RankingSettingsWriteSchema,
  RankingSettingsRecordsQuerySchema,
  RankingSettingsRecordsResponseSchema,
  RankingRuntimeResponseSchema,
  ErrorResponseSchema,
  rankingSettingsEtag,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { RankingSettingsService } from './ranking-settings.service.js';

@Controller('admin/settings/rankings')
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
export class RankingSettingsController {
  constructor(@Inject(RankingSettingsService) readonly service: RankingSettingsService) {}
  private async reply(response: Response, result: ReturnType<RankingSettingsService['read']>) {
    const body = await result;
    response.setHeader('ETag', rankingSettingsEtag(body.meta.revision));
    return body;
  }
  @Get()
  @ApiOperation({ operationId: 'getRankingSettings' })
  @ApiOkResponse({ standardSchema: RankingSettingsResponseSchema })
  @SerializeOptions({ schema: RankingSettingsResponseSchema })
  read(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.reply(response, this.service.read(request));
  }
  @Get('status')
  @ApiOperation({ operationId: 'getRankingRuntime' })
  @ApiOkResponse({ standardSchema: RankingRuntimeResponseSchema })
  @SerializeOptions({ schema: RankingRuntimeResponseSchema })
  runtime(@Req() request: Request) {
    return this.service.runtime(request);
  }
  @Get('records')
  @ApiOperation({ operationId: 'getRankingSettingsRecords' })
  @ApiOkResponse({ standardSchema: RankingSettingsRecordsResponseSchema })
  @SerializeOptions({ schema: RankingSettingsRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Query({ schema: RankingSettingsRecordsQuerySchema })
    input: z.infer<typeof RankingSettingsRecordsQuerySchema>,
  ) {
    return this.service.records(request, input);
  }
  @Patch()
  @ApiOperation({ operationId: 'updateRankingSettings' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: RankingSettingsResponseSchema })
  @SerializeOptions({ schema: RankingSettingsResponseSchema })
  update(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: RankingSettingsWriteSchema })
    input: z.infer<typeof RankingSettingsWriteSchema>,
  ) {
    return this.reply(response, this.service.update(request, response, input));
  }
}
