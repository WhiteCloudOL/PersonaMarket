import {
  Body,
  Controller,
  Delete,
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
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiResponse,
} from '@nestjs/swagger';
import {
  AuthContextResponseSchema,
  AuthNoticeResponseSchema,
  AuthSessionsResponseSchema,
  ErrorResponseSchema,
  ForgotPasswordRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  ReauthenticateRequestSchema,
  MfaCodeRequestSchema,
  MfaConfirmResponseSchema,
  MfaSetupResponseSchema,
  RegisterRequestSchema,
  RequestRegistrationCodeSchema,
  ResetPasswordRequestSchema,
  SessionIdParamsSchema,
  VerifyEmailRequestSchema,
} from '@personamarket/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import { MfaService } from './mfa.service.js';
const CsrfHeader = () =>
  ApiHeader({
    name: 'X-CSRF-Token',
    required: true,
    description: '同源 CSRF 令牌，由认证上下文提供',
  });

@ApiTags('auth')
@ApiBadRequestResponse({ standardSchema: ErrorResponseSchema })
@ApiUnauthorizedResponse({ standardSchema: ErrorResponseSchema })
@ApiForbiddenResponse({ standardSchema: ErrorResponseSchema })
@ApiTooManyRequestsResponse({ standardSchema: ErrorResponseSchema })
@ApiServiceUnavailableResponse({ standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@UseGuards(AuthGuard)
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MfaService) private readonly mfa: MfaService,
  ) {}
  @Get('context')
  @ApiOperation({ operationId: 'getAuthContext', summary: '读取身份与 CSRF 上下文' })
  @ApiQuery({
    name: 'registration',
    required: false,
    enum: ['configuration'],
    description: '只读取注册和邮件配置，发送验证码时另行检查邮件连接',
  })
  @ApiOkResponse({ standardSchema: AuthContextResponseSchema })
  @SerializeOptions({ schema: AuthContextResponseSchema })
  context(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query('registration') registration?: string,
  ) {
    return this.auth.context(request, response, registration !== 'configuration');
  }

  @Post('register/code')
  @HttpCode(200)
  @CsrfHeader()
  @ApiOperation({ operationId: 'requestRegistrationCode', summary: '申请注册邮箱验证码' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  registerCode(
    @Body({ schema: RequestRegistrationCodeSchema })
    input: z.infer<typeof RequestRegistrationCodeSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.requestRegistrationCode(input.email, request, response);
  }

  @Post('register')
  @HttpCode(200)
  @CsrfHeader()
  @ApiOperation({ operationId: 'registerAccount', summary: '校验邮箱验证码后创建账号' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  register(
    @Body({ schema: RegisterRequestSchema }) input: z.infer<typeof RegisterRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.register(input, request, response);
  }

  @Post('login')
  @HttpCode(200)
  @CsrfHeader()
  @ApiOperation({ operationId: 'loginAccount', summary: '密码登录并旋转会话' })
  @ApiOkResponse({ standardSchema: LoginResponseSchema })
  @SerializeOptions({ schema: LoginResponseSchema })
  login(
    @Body({ schema: LoginRequestSchema }) input: z.infer<typeof LoginRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.login(input, request, response);
  }

  @Post('reauthenticate')
  @HttpCode(200)
  @CsrfHeader()
  @ApiOperation({
    operationId: 'reauthenticateAccount',
    summary: '未绑定 MFA 的账号以当前密码确认高危操作',
  })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  reauthenticate(
    @Body({ schema: ReauthenticateRequestSchema })
    input: z.infer<typeof ReauthenticateRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.reauthenticate(input.currentPassword, request, response);
  }

  @Post('verify-email')
  @HttpCode(200)
  @CsrfHeader()
  @ApiOperation({ operationId: 'verifyEmail', summary: '消费单次邮箱验证令牌' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  verifyEmail(
    @Body({ schema: VerifyEmailRequestSchema }) input: z.infer<typeof VerifyEmailRequestSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.consumeToken(input.token, 'email_verify', response);
  }

  @Post('resend-verification')
  @HttpCode(200)
  @CsrfHeader()
  @ApiOperation({ operationId: 'resendVerification', summary: '重新发送验证邮件' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  resend(
    @Body({ schema: ForgotPasswordRequestSchema })
    input: z.infer<typeof ForgotPasswordRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.requestMail(input.email, 'email_verify', request, response);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @CsrfHeader()
  @ApiOperation({ operationId: 'forgotPassword', summary: '申请密码重置邮件' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  forgot(
    @Body({ schema: ForgotPasswordRequestSchema })
    input: z.infer<typeof ForgotPasswordRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.requestMail(input.email, 'password_reset', request, response);
  }

  @Post('reset-password')
  @HttpCode(200)
  @CsrfHeader()
  @ApiOperation({ operationId: 'resetPassword', summary: '消费重置令牌并撤销已有会话' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  reset(
    @Body({ schema: ResetPasswordRequestSchema }) input: z.infer<typeof ResetPasswordRequestSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.consumeToken(input.token, 'password_reset', response, input.password);
  }

  @Post('logout')
  @HttpCode(200)
  @CsrfHeader()
  @ApiOperation({ operationId: 'logoutAccount', summary: '退出当前会话' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.auth.logout(request, response);
  }

  @Get('sessions')
  @ApiOperation({ operationId: 'listAuthSessions', summary: '读取本人的有效设备会话' })
  @ApiOkResponse({ standardSchema: AuthSessionsResponseSchema })
  @SerializeOptions({ schema: AuthSessionsResponseSchema })
  sessions(@Req() request: Request) {
    return this.auth.sessions(request);
  }

  @Delete('sessions')
  @CsrfHeader()
  @ApiOperation({ operationId: 'logoutAllSessions', summary: '退出全部设备会话' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  logoutAll(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.auth.logout(request, response, true);
  }

  @Delete('sessions/:id')
  @CsrfHeader()
  @ApiOperation({ operationId: 'revokeAuthSession', summary: '撤销本人指定设备会话' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  revoke(
    @Param({ schema: SessionIdParamsSchema }) params: z.infer<typeof SessionIdParamsSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.logout(request, response, false, params.id);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @CsrfHeader()
  @ApiOperation({ operationId: 'setupMfa', summary: '生成限时二次验证引导' })
  @ApiOkResponse({ standardSchema: MfaSetupResponseSchema })
  @SerializeOptions({ schema: MfaSetupResponseSchema })
  setupMfa(@Req() request: Request) {
    return this.mfa.setup(request);
  }

  @Post('mfa/confirm')
  @HttpCode(200)
  @CsrfHeader()
  @ApiOperation({ operationId: 'confirmMfa', summary: '确认绑定并一次性提供恢复码' })
  @ApiOkResponse({ standardSchema: MfaConfirmResponseSchema })
  @SerializeOptions({ schema: MfaConfirmResponseSchema })
  confirmMfa(
    @Body({ schema: MfaCodeRequestSchema }) input: z.infer<typeof MfaCodeRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.mfa.verify(input.code, true, request, response);
  }

  @Post('mfa/verify')
  @HttpCode(200)
  @CsrfHeader()
  @ApiOperation({ operationId: 'verifyMfa', summary: '验证动态码或一次性恢复码' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  verifyMfa(
    @Body({ schema: MfaCodeRequestSchema }) input: z.infer<typeof MfaCodeRequestSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.mfa.verify(input.code, false, request, response);
  }
}
