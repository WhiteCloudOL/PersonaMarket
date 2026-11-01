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
  ModelSuggestionsResponseSchema,
  ModelSuggestionsWriteSchema,
  ModelSuggestionsRecordsQuerySchema,
  ModelSuggestionsRecordsResponseSchema,
  PublicModelSuggestionsResponseSchema,
  ErrorResponseSchema,
  modelSuggestionsEtag,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { ModelSuggestionsService } from './model-suggestions.service.js';

@Controller('site/model-suggestions')
@ApiTags('site-model-suggestions')
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class PublicModelSuggestionsController {
  constructor(@Inject(ModelSuggestionsService) readonly service: ModelSuggestionsService) {}
  @Get()
  @ApiOperation({ operationId: 'getPublicModelSuggestions' })
  @ApiOkResponse({ standardSchema: PublicModelSuggestionsResponseSchema })
  @SerializeOptions({ schema: PublicModelSuggestionsResponseSchema })
  read(@Req() request: Request) {
    return this.service.publicRead(request);
  }
}

@Controller('admin/settings/model-suggestions')
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
export class ModelSuggestionsController {
  constructor(@Inject(ModelSuggestionsService) readonly service: ModelSuggestionsService) {}
  private async reply(response: Response, result: ReturnType<ModelSuggestionsService['read']>) {
    const body = await result;
    response.setHeader('ETag', modelSuggestionsEtag(body.meta.revision));
    return body;
  }
  @Get()
  @ApiOperation({ operationId: 'getModelSuggestions' })
  @ApiOkResponse({ standardSchema: ModelSuggestionsResponseSchema })
  @SerializeOptions({ schema: ModelSuggestionsResponseSchema })
  read(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.reply(response, this.service.read(request));
  }
  @Get('records')
  @ApiOperation({ operationId: 'getModelSuggestionsRecords' })
  @ApiOkResponse({ standardSchema: ModelSuggestionsRecordsResponseSchema })
  @SerializeOptions({ schema: ModelSuggestionsRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Query({ schema: ModelSuggestionsRecordsQuerySchema })
    input: z.infer<typeof ModelSuggestionsRecordsQuerySchema>,
  ) {
    return this.service.records(request, input);
  }
  @Patch()
  @ApiOperation({ operationId: 'updateModelSuggestions' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: ModelSuggestionsResponseSchema })
  @SerializeOptions({ schema: ModelSuggestionsResponseSchema })
  update(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: ModelSuggestionsWriteSchema })
    input: z.infer<typeof ModelSuggestionsWriteSchema>,
  ) {
    return this.reply(response, this.service.update(request, response, input));
  }
}
