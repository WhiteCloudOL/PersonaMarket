import { Controller, Get, Inject, Req, SerializeOptions, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  AdminOverviewResponseSchema,
  ErrorResponseSchema,
  ReviewIndicatorsResponseSchema,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { AdminOverviewService } from './admin-overview.service.js';

@Controller('admin/overview')
@UseGuards(AuthGuard)
@ApiTags('admin-overview')
@ApiHeader({ name: 'X-Expected-Account', required: false })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class AdminOverviewController {
  constructor(@Inject(AdminOverviewService) readonly service: AdminOverviewService) {}
  @Get('review-indicators')
  @ApiOperation({ operationId: 'getReviewIndicators', summary: '读取当前角色可处理的审核待办标记' })
  @ApiOkResponse({ standardSchema: ReviewIndicatorsResponseSchema })
  @SerializeOptions({ schema: ReviewIndicatorsResponseSchema })
  indicators(@Req() request: Request) {
    return this.service.indicators(request);
  }
  @Get()
  @ApiOperation({
    operationId: 'getAdminOverview',
    summary: '读取真实队列、运营统计与安全系统观测',
  })
  @ApiOkResponse({ standardSchema: AdminOverviewResponseSchema })
  @SerializeOptions({ schema: AdminOverviewResponseSchema })
  read(@Req() request: Request) {
    return this.service.read(request);
  }
}
