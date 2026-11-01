import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  IdSchema,
  ErrorResponseSchema,
  AdminRankingGenerationResponseSchema,
  AdminRankingRetryReceiptResponseSchema,
  AdminRankingRetryResponseSchema,
  RetryAdminRankingGenerationSchema,
  type RetryAdminRankingGeneration,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { RankingRetryService } from './ranking-retry.service.js';
const pathSchema = z.strictObject({ id: IdSchema });

@Controller('admin/rankings/generations')
@UseGuards(AuthGuard)
@ApiTags('admin-ranking-recovery')
@ApiHeader({ name: 'X-Expected-Account', required: false })
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class RankingRetryController {
  constructor(@Inject(RankingRetryService) readonly service: RankingRetryService) {}
  @Get(':id')
  @ApiOperation({
    operationId: 'getAdminRankingGeneration',
    summary: '核对稳定排行批次及当前轮真实恢复资格',
  })
  @ApiOkResponse({ standardSchema: AdminRankingGenerationResponseSchema })
  @SerializeOptions({ schema: AdminRankingGenerationResponseSchema })
  detail(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: pathSchema }) { id }: z.infer<typeof pathSchema>,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.service.detail(request, id);
  }
  @Get(':id/retry-receipt')
  @ApiOperation({
    operationId: 'getAdminRankingRetryReceipt',
    summary: '只读核对原恢复命令是否已受理',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Retry-Request-Hash', required: true })
  @ApiOkResponse({ standardSchema: AdminRankingRetryReceiptResponseSchema })
  @SerializeOptions({ schema: AdminRankingRetryReceiptResponseSchema })
  receipt(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: pathSchema }) { id }: z.infer<typeof pathSchema>,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.service.receipt(request, id);
  }
  @Post(':id/retry')
  @HttpCode(200)
  @ApiOperation({ operationId: 'retryAdminRankingGeneration', summary: '按冻结定义恢复原排行批次' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: AdminRankingRetryResponseSchema })
  @SerializeOptions({ schema: AdminRankingRetryResponseSchema })
  retry(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: pathSchema }) { id }: z.infer<typeof pathSchema>,
    @Body({ schema: RetryAdminRankingGenerationSchema }) input: RetryAdminRankingGeneration,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.service.retry(request, response, id, input);
  }
}
