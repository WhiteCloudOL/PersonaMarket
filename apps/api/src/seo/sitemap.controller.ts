import { Controller, Get, Inject, Query, Req, SerializeOptions } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ErrorResponseSchema,
  PublicSitemapQuerySchema,
  PublicSitemapIndexResponseSchema,
  PublicSitemapEntriesResponseSchema,
  type PublicSitemapQuery,
} from '@personamarket/contracts';
import { SitemapService } from './sitemap.service.js';

@ApiTags('discovery')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
@Controller('public/sitemap')
export class SitemapController {
  constructor(@Inject(SitemapService) readonly service: SitemapService) {}
  @Get('index')
  @ApiOperation({ operationId: 'getPublicSitemapIndex' })
  @ApiOkResponse({ standardSchema: PublicSitemapIndexResponseSchema })
  @SerializeOptions({ schema: PublicSitemapIndexResponseSchema })
  index(@Req() request: Request) {
    return this.service.index(request);
  }

  @Get('entries')
  @ApiOperation({ operationId: 'getPublicSitemapEntries' })
  @ApiOkResponse({ standardSchema: PublicSitemapEntriesResponseSchema })
  @SerializeOptions({ schema: PublicSitemapEntriesResponseSchema })
  entries(
    @Req() request: Request,
    @Query({ schema: PublicSitemapQuerySchema }) query: PublicSitemapQuery,
  ) {
    return this.service.entries(request, query.page);
  }
}
