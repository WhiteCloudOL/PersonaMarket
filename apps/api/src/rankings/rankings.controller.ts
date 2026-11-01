import { Controller, Get, Inject, Query, Req, SerializeOptions } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import {
  ErrorResponseSchema,
  RankingQuerySchema,
  RankingListResponseSchema,
  type RankingQuery,
} from '@personamarket/contracts';
import type { Request } from 'express';
import { RankingsService } from './rankings.service.js';

@ApiTags('discovery')
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
@Controller('rankings')
export class RankingsController {
  constructor(@Inject(RankingsService) readonly service: RankingsService) {}
  @Get()
  @ApiOperation({ operationId: 'listPublicRankings' })
  @ApiOkResponse({ standardSchema: RankingListResponseSchema })
  @SerializeOptions({ schema: RankingListResponseSchema })
  list(@Req() request: Request, @Query({ schema: RankingQuerySchema }) query: RankingQuery) {
    return this.service.list(request, query);
  }
}
