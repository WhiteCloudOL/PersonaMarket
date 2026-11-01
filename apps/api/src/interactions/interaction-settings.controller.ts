import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ErrorResponseSchema,
  InteractionSettingsSchema,
  InteractionSettingsResponseSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { InteractionSettingsService } from './interaction-settings.service.js';

@ApiTags('community')
@UseGuards(AuthGuard)
@Controller('admin/settings/community')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
export class InteractionSettingsController {
  constructor(@Inject(InteractionSettingsService) readonly service: InteractionSettingsService) {}
  @Get()
  @ApiOperation({ operationId: 'getCommunitySettings' })
  @ApiOkResponse({ standardSchema: InteractionSettingsResponseSchema })
  @SerializeOptions({ schema: InteractionSettingsResponseSchema })
  async read(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.service.read(request);
    response.setHeader('ETag', '"community-' + result.meta.revision + '"');
    return result;
  }
  @Patch()
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOperation({ operationId: 'updateCommunitySettings' })
  @ApiOkResponse({ standardSchema: InteractionSettingsResponseSchema })
  @SerializeOptions({ schema: InteractionSettingsResponseSchema })
  async update(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: InteractionSettingsSchema }) input: z.infer<typeof InteractionSettingsSchema>,
  ) {
    const result = await this.service.update(request, response, input);
    response.setHeader('ETag', '"community-' + result.meta.revision + '"');
    return result;
  }
}
