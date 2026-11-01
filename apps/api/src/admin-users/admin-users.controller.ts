import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AdminUserIdSchema,
  AdminUserContentQuerySchema,
  AdminUserPublicPersonasResponseSchema,
  AdminUserReviewRecordsQuerySchema,
  AdminUserReviewRecordsResponseSchema,
  AdminDeactivationPathSchema,
  ReviewDeactivationRequestSchema,
  AdminUserResponseSchema,
  AdminUsersQuerySchema,
  AdminUsersResponseSchema,
  ErrorResponseSchema,
  RevokeAdminUserSessionsSchema,
  SetAdminUserRoleSchema,
  SetAdminUserStatusSchema,
} from '@personamarket/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { AdminUsersService } from './admin-users.service.js';

@ApiTags('user-management')
@ApiHeader({
  name: 'X-Expected-Account',
  required: false,
  description: '仅与实际会话核对，不授予身份或权限',
})
@Controller('admin/users')
@UseGuards(AuthGuard)
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class AdminUsersController {
  constructor(@Inject(AdminUsersService) readonly service: AdminUsersService) {}
  @Post(':id/deactivation-requests/:requestId/review')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'reviewDeactivationRequest',
    summary: '核对具体申请与近期身份后批准或驳回停用申请',
  })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminUserResponseSchema })
  @SerializeOptions({ schema: AdminUserResponseSchema })
  reviewDeactivation(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: AdminDeactivationPathSchema })
    { id, requestId: applicationId }: z.infer<typeof AdminDeactivationPathSchema>,
    @Body({ schema: ReviewDeactivationRequestSchema })
    input: z.infer<typeof ReviewDeactivationRequestSchema>,
  ) {
    return this.service.reviewDeactivation(request, response, id, applicationId, input);
  }
  @Get()
  @ApiOperation({ operationId: 'getAdminUsers', summary: '分页搜索用户与账号状态' })
  @ApiOkResponse({ standardSchema: AdminUsersResponseSchema })
  @SerializeOptions({ schema: AdminUsersResponseSchema })
  list(
    @Req() request: Request,
    @Query({ schema: AdminUsersQuerySchema }) query: z.infer<typeof AdminUsersQuerySchema>,
  ) {
    return this.service.list(request, query);
  }
  @Get(':id')
  @ApiOperation({ operationId: 'getAdminUser', summary: '读取用户管理详情与处理记录' })
  @ApiOkResponse({ standardSchema: AdminUserResponseSchema })
  @SerializeOptions({ schema: AdminUserResponseSchema })
  detail(
    @Req() request: Request,
    @Param({ schema: AdminUserIdSchema }) { id }: z.infer<typeof AdminUserIdSchema>,
  ) {
    return this.service.detail(request, id);
  }
  @Get(':id/public-personas')
  @ApiOperation({
    operationId: 'getAdminUserPublicPersonas',
    summary: '按用户归属分页读取当前公开作品',
  })
  @ApiOkResponse({ standardSchema: AdminUserPublicPersonasResponseSchema })
  @SerializeOptions({ schema: AdminUserPublicPersonasResponseSchema })
  publicPersonas(
    @Req() request: Request,
    @Param({ schema: AdminUserIdSchema }) { id }: z.infer<typeof AdminUserIdSchema>,
    @Query({ schema: AdminUserContentQuerySchema })
    query: z.infer<typeof AdminUserContentQuerySchema>,
  ) {
    return this.service.publicPersonas(request, id, query);
  }
  @Get(':id/review-records')
  @ApiOperation({
    operationId: 'getAdminUserReviewRecords',
    summary: '分页读取用户作品与评论的审核及处置记录',
  })
  @ApiOkResponse({ standardSchema: AdminUserReviewRecordsResponseSchema })
  @SerializeOptions({ schema: AdminUserReviewRecordsResponseSchema })
  reviewRecords(
    @Req() request: Request,
    @Param({ schema: AdminUserIdSchema }) { id }: z.infer<typeof AdminUserIdSchema>,
    @Query({ schema: AdminUserReviewRecordsQuerySchema })
    query: z.infer<typeof AdminUserReviewRecordsQuerySchema>,
  ) {
    return this.service.reviewRecords(request, id, query);
  }
  @Put(':id/role')
  @ApiOperation({ operationId: 'setAdminUserRole', summary: '核对版本与近期身份后调整角色' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminUserResponseSchema })
  @SerializeOptions({ schema: AdminUserResponseSchema })
  role(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: AdminUserIdSchema }) { id }: z.infer<typeof AdminUserIdSchema>,
    @Body({ schema: SetAdminUserRoleSchema }) input: z.infer<typeof SetAdminUserRoleSchema>,
  ) {
    return this.service.role(request, response, id, input);
  }
  @Put(':id/status')
  @ApiOperation({ operationId: 'setAdminUserStatus', summary: '按明确范围封禁或恢复账号' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminUserResponseSchema })
  @SerializeOptions({ schema: AdminUserResponseSchema })
  status(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: AdminUserIdSchema }) { id }: z.infer<typeof AdminUserIdSchema>,
    @Body({ schema: SetAdminUserStatusSchema }) input: z.infer<typeof SetAdminUserStatusSchema>,
  ) {
    return this.service.status(request, response, id, input);
  }
  @Put(':id/sessions')
  @ApiOperation({ operationId: 'revokeAdminUserSessions', summary: '撤销指定账号全部会话' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminUserResponseSchema })
  @SerializeOptions({ schema: AdminUserResponseSchema })
  sessions(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: AdminUserIdSchema }) { id }: z.infer<typeof AdminUserIdSchema>,
    @Body({ schema: RevokeAdminUserSessionsSchema })
    input: z.infer<typeof RevokeAdminUserSessionsSchema>,
  ) {
    return this.service.revokeSessions(request, response, id, input);
  }
}
