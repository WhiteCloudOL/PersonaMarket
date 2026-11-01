import { Controller, Get, Inject, Req, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { PublicFacetsResponseSchema, ErrorResponseSchema } from '@personamarket/contracts';
import type { Request } from 'express';
import { FacetsRepository } from './facets.repository.js';
import { AuthService } from '../auth/auth.service.js';
@ApiTags('personas')
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@Controller('site/persona-filters')
export class FacetsController {
  constructor(
    @Inject(FacetsRepository) readonly repository: FacetsRepository,
    @Inject(AuthService) readonly auth: AuthService,
  ) {}
  @Get()
  @ApiOperation({ operationId: 'getPublicPersonaFilters' })
  @ApiOkResponse({ standardSchema: PublicFacetsResponseSchema })
  @SerializeOptions({ schema: PublicFacetsResponseSchema })
  async read(@Req() request: Request) {
    await this.auth.rate.take('public-facets', request.ip ?? 'unknown', 60, 60);
    return this.repository.read();
  }
}
