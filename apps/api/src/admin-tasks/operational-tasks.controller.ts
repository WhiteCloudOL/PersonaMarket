import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Res,
  Inject,
  UseGuards,
  HttpCode,
  SerializeOptions,
} from '@nestjs/common';
import { ApiHeader, ApiTags, ApiOperation, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  OperationalTaskPathSchema,
  ErrorResponseSchema,
  OperationalTaskCommandSchema,
  OperationalTaskDetailResponseSchema,
  OperationalTaskActionResponseSchema,
  OperationalTaskReceiptResponseSchema,
  type OperationalTaskPath,
  type OperationalTaskCommand,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { OperationalTasksService } from './operational-tasks.service.js';
@Controller('admin/operations')
@UseGuards(AuthGuard)
@ApiTags('admin-operations')
@ApiHeader({ name: 'X-Expected-Account', required: false })
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class OperationalTasksController {
  constructor(@Inject(OperationalTasksService) readonly service: OperationalTasksService) {}
  @Get(':kind/:id')
  @ApiOperation({ operationId: 'getOperationalTask', summary: '核对文件清理结果与邮件业务上下文' })
  @ApiOkResponse({ standardSchema: OperationalTaskDetailResponseSchema })
  @SerializeOptions({ schema: OperationalTaskDetailResponseSchema })
  detail(
    @Req() request: Request,
    @Param({ schema: OperationalTaskPathSchema }) target: OperationalTaskPath,
  ) {
    return this.service.detail(request, target);
  }
  @Post(':kind/:id')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'handleOperationalTask',
    summary: '重查文件清理或记录邮件人工核对，不盲目重发邮件',
  })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: OperationalTaskActionResponseSchema })
  @SerializeOptions({ schema: OperationalTaskActionResponseSchema })
  handle(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: OperationalTaskPathSchema }) target: OperationalTaskPath,
    @Body({ schema: OperationalTaskCommandSchema }) input: OperationalTaskCommand,
  ) {
    return this.service.handle(request, response, target, input);
  }
  @Get(':kind/:id/receipt')
  @ApiOperation({
    operationId: 'getOperationalTaskReceipt',
    summary: '只读核对原处理请求的实际受理回执',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Retry-Request-Hash', required: true })
  @ApiOkResponse({ standardSchema: OperationalTaskReceiptResponseSchema })
  @SerializeOptions({ schema: OperationalTaskReceiptResponseSchema })
  receipt(
    @Req() request: Request,
    @Param({ schema: OperationalTaskPathSchema }) target: OperationalTaskPath,
  ) {
    return this.service.receipt(request, target);
  }
}
