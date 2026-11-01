import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AuthNoticeResponseSchema,
  ChangeEmailRequestSchema,
  ChangePasswordRequestSchema,
  DeactivationRequestSchema,
  DeactivationResponseSchema,
  ErrorResponseSchema,
  VerifyEmailRequestSchema,
} from '@personamarket/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { SecurityService } from './security.service.js';
@ApiTags('account-security')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
@UseGuards(AuthGuard)
@Controller('me/security')
export class SecurityController {
  constructor(@Inject(SecurityService) private readonly service: SecurityService) {}
  @Post('password')
  @HttpCode(200)
  @ApiOperation({ operationId: 'changeOwnPassword', summary: '校验当前密码并撤销全部会话' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  password(
    @Body({ schema: ChangePasswordRequestSchema })
    input: z.infer<typeof ChangePasswordRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.service.password(input, request, response);
  }
  @Post('email')
  @HttpCode(200)
  @ApiOperation({ operationId: 'requestOwnEmailChange', summary: '向新邮箱发送用途绑定的确认链接' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  email(
    @Body({ schema: ChangeEmailRequestSchema }) input: z.infer<typeof ChangeEmailRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.service.email(input, request, response);
  }
  @Get('deactivation')
  @ApiOperation({ operationId: 'getOwnDeactivationRequest', summary: '读取本人的停用申请状态' })
  @ApiOkResponse({ standardSchema: DeactivationResponseSchema })
  @SerializeOptions({ schema: DeactivationResponseSchema })
  deactivation(@Req() request: Request) {
    return this.service.deactivation(request);
  }
  @Post('deactivation')
  @HttpCode(200)
  @ApiOperation({ operationId: 'requestOwnDeactivation', summary: '校验当前密码并提交停用申请' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  requestDeactivation(
    @Body({ schema: DeactivationRequestSchema }) input: z.infer<typeof DeactivationRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.service.requestDeactivation(input, request, response);
  }
  @Delete('deactivation')
  @ApiOperation({ operationId: 'withdrawOwnDeactivation', summary: '撤回本人待处理的停用申请' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  withdraw(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.service.withdraw(request, response);
  }
}
@ApiTags('account-security')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@UseGuards(AuthGuard)
@Controller('auth/confirm-email-change')
export class EmailChangeController {
  constructor(@Inject(SecurityService) private readonly service: SecurityService) {}
  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'confirmOwnEmailChange',
    summary: '单次确认新邮箱并撤销全部旧会话和链接',
  })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  confirm(
    @Body({ schema: VerifyEmailRequestSchema }) input: z.infer<typeof VerifyEmailRequestSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.service.confirmEmail(input.token, response);
  }
}
