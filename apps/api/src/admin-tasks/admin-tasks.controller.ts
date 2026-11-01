import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
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
  AdminTaskQuerySchema,
  AdminTaskListResponseSchema,
  ErrorResponseSchema,
  AdminTaskPathSchema,
  RetryAdminTaskSchema,
  AdminTaskRetryResponseSchema,
  AdminTaskRetryHistoryResponseSchema,
  AdminTaskDetailResponseSchema,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { AdminTasksService } from './admin-tasks.service.js';

@Controller('admin/tasks')
@UseGuards(AuthGuard)
@ApiTags('admin-tasks')
@ApiHeader({ name: 'X-Expected-Account', required: false })
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class AdminTasksController {
  constructor(@Inject(AdminTasksService) readonly service: AdminTasksService) {}
  @Get(':source/:id')
  @ApiOperation({ operationId: 'getAdminTaskFailure', summary: '读取单个任务当前可核验的失败状态' })
  @ApiOkResponse({ standardSchema: AdminTaskDetailResponseSchema })
  @SerializeOptions({ schema: AdminTaskDetailResponseSchema })
  detail(
    @Req() request: Request,
    @Param({ schema: AdminTaskPathSchema }) target: z.infer<typeof AdminTaskPathSchema>,
  ) {
    return this.service.detail(request, target);
  }
  @Get(':source/:id/retries')
  @ApiOperation({ operationId: 'listAdminTaskRetries', summary: '读取任务人工重试审计' })
  @ApiOkResponse({ standardSchema: AdminTaskRetryHistoryResponseSchema })
  @SerializeOptions({ schema: AdminTaskRetryHistoryResponseSchema })
  history(
    @Req() request: Request,
    @Param({ schema: AdminTaskPathSchema }) target: z.infer<typeof AdminTaskPathSchema>,
  ) {
    return this.service.history(request, target);
  }
  @Post(':source/:id/retry')
  @HttpCode(200)
  @ApiOperation({ operationId: 'retryAdminTask', summary: '核验图片失败状态后创建受控重试' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminTaskRetryResponseSchema })
  @SerializeOptions({ schema: AdminTaskRetryResponseSchema })
  retry(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: AdminTaskPathSchema }) target: z.infer<typeof AdminTaskPathSchema>,
    @Body({ schema: RetryAdminTaskSchema }) input: z.infer<typeof RetryAdminTaskSchema>,
  ) {
    return this.service.retry(request, response, target, input);
  }
  @Get()
  @ApiOperation({ operationId: 'listAdminTaskFailures', summary: '读取真实分发和业务失败任务' })
  @ApiOkResponse({ standardSchema: AdminTaskListResponseSchema })
  @SerializeOptions({ schema: AdminTaskListResponseSchema })
  list(
    @Req() request: Request,
    @Query({ schema: AdminTaskQuerySchema }) input: z.infer<typeof AdminTaskQuerySchema>,
  ) {
    return this.service.list(request, input);
  }
}
