import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
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
  NotificationsQuerySchema,
  NotificationsResponseSchema,
  NotificationCountResponseSchema,
  NotificationIdSchema,
  ReadNotificationSchema,
  ReadAllNotificationsSchema,
  NotificationReadResponseSchema,
  NotificationRecipientQuerySchema,
  NotificationRecipientResponseSchema,
  AdminNoticesQuerySchema,
  AdminNoticesResponseSchema,
  AdminNoticeResponseSchema,
  CreateAdminNoticeSchema,
  RetryAdminNoticeSchema,
  ErrorResponseSchema,
  NotificationFailuresQuerySchema,
  NotificationFailuresResponseSchema,
  NotificationFailureResponseSchema,
  NotificationPreferencesResponseSchema,
  UpdateNotificationPreferencesSchema,
  NotificationDeliveryDetailResponseSchema,
  NotificationRetryReceiptQuerySchema,
  NotificationRetryReceiptResponseSchema,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { NotificationsService } from './notifications.service.js';

@Controller('me/notifications')
@UseGuards(AuthGuard)
@ApiTags('notifications')
@ApiHeader({ name: 'X-Expected-Account', required: false })
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class NotificationsController {
  constructor(@Inject(NotificationsService) readonly service: NotificationsService) {}
  @Get()
  @ApiOperation({ operationId: 'listNotifications' })
  @ApiOkResponse({ standardSchema: NotificationsResponseSchema })
  @SerializeOptions({ schema: NotificationsResponseSchema })
  list(
    @Req() request: Request,
    @Query({ schema: NotificationsQuerySchema }) input: z.infer<typeof NotificationsQuerySchema>,
  ) {
    return this.service.list(request, input);
  }
  @Get('count')
  @ApiOperation({ operationId: 'getNotificationCount' })
  @ApiOkResponse({ standardSchema: NotificationCountResponseSchema })
  @SerializeOptions({ schema: NotificationCountResponseSchema })
  count(@Req() request: Request) {
    return this.service.counts(request);
  }
  @Get('preferences')
  @ApiOperation({ operationId: 'getNotificationPreferences' })
  @ApiOkResponse({ standardSchema: NotificationPreferencesResponseSchema })
  @SerializeOptions({ schema: NotificationPreferencesResponseSchema })
  preferences(@Req() request: Request) {
    return this.service.preferences(request);
  }
  @Patch('preferences')
  @ApiOperation({ operationId: 'updateNotificationPreferences' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
  @ApiOkResponse({ standardSchema: NotificationPreferencesResponseSchema })
  @SerializeOptions({ schema: NotificationPreferencesResponseSchema })
  updatePreferences(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: UpdateNotificationPreferencesSchema })
    input: z.infer<typeof UpdateNotificationPreferencesSchema>,
  ) {
    return this.service.updatePreferences(request, response, input);
  }
  @Patch('read-all')
  @ApiOperation({ operationId: 'readAllNotifications' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: NotificationReadResponseSchema })
  @SerializeOptions({ schema: NotificationReadResponseSchema })
  readAll(
    @Req() request: Request,
    @Body({ schema: ReadAllNotificationsSchema }) input: z.infer<typeof ReadAllNotificationsSchema>,
  ) {
    return this.service.readAll(request, input.throughId);
  }
  @Patch(':id/read')
  @ApiOperation({ operationId: 'readNotification' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: NotificationReadResponseSchema })
  @SerializeOptions({ schema: NotificationReadResponseSchema })
  read(
    @Req() request: Request,
    @Param({ schema: NotificationIdSchema }) { id }: z.infer<typeof NotificationIdSchema>,
    @Body({ schema: ReadNotificationSchema }) input: z.infer<typeof ReadNotificationSchema>,
  ) {
    // 保留严格空请求体的契约校验，已读命令不接受客户端状态字段
    void input;
    return this.service.readOne(request, id);
  }
}

@Controller('admin/notifications')
@UseGuards(AuthGuard)
@ApiTags('admin-notifications')
@ApiHeader({ name: 'X-Expected-Account', required: false })
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class AdminNotificationsController {
  constructor(@Inject(NotificationsService) readonly service: NotificationsService) {}
  @Get('deliveries/:id/retry-receipt')
  @ApiOperation({ operationId: 'getNotificationRetryReceipt' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: NotificationRetryReceiptResponseSchema })
  @SerializeOptions({ schema: NotificationRetryReceiptResponseSchema })
  retryReceipt(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: NotificationIdSchema }) { id }: z.infer<typeof NotificationIdSchema>,
    @Query({ schema: NotificationRetryReceiptQuerySchema })
    input: z.infer<typeof NotificationRetryReceiptQuerySchema>,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.service.retryReceipt(request, id, input);
  }
  @Get('deliveries/:id')
  @ApiOperation({ operationId: 'getNotificationDelivery' })
  @ApiOkResponse({ standardSchema: NotificationDeliveryDetailResponseSchema })
  @SerializeOptions({ schema: NotificationDeliveryDetailResponseSchema })
  delivery(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: NotificationIdSchema }) { id }: z.infer<typeof NotificationIdSchema>,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.service.deliveryDetail(request, id);
  }
  @Get('failures/list')
  @ApiOperation({ operationId: 'listNotificationFailures' })
  @ApiOkResponse({ standardSchema: NotificationFailuresResponseSchema })
  @SerializeOptions({ schema: NotificationFailuresResponseSchema })
  failures(
    @Req() request: Request,
    @Query({ schema: NotificationFailuresQuerySchema })
    input: z.infer<typeof NotificationFailuresQuerySchema>,
  ) {
    return this.service.failures(request, input);
  }
  @Post('failures/:id/retry')
  @HttpCode(200)
  @ApiOperation({ operationId: 'retryNotificationFailure' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: NotificationFailureResponseSchema })
  @SerializeOptions({ schema: NotificationFailureResponseSchema })
  retryFailure(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: NotificationIdSchema }) { id }: z.infer<typeof NotificationIdSchema>,
    @Body({ schema: RetryAdminNoticeSchema }) input: z.infer<typeof RetryAdminNoticeSchema>,
  ) {
    return this.service.retryFailure(request, response, id, input);
  }
  @Get('recipients/lookup')
  @ApiOperation({ operationId: 'findNotificationRecipient' })
  @ApiOkResponse({ standardSchema: NotificationRecipientResponseSchema })
  @SerializeOptions({ schema: NotificationRecipientResponseSchema })
  recipient(
    @Req() request: Request,
    @Query({ schema: NotificationRecipientQuerySchema })
    input: z.infer<typeof NotificationRecipientQuerySchema>,
  ) {
    return this.service.recipient(request, input.username);
  }
  @Get()
  @ApiOperation({ operationId: 'listAdminNotices' })
  @ApiOkResponse({ standardSchema: AdminNoticesResponseSchema })
  @SerializeOptions({ schema: AdminNoticesResponseSchema })
  list(
    @Req() request: Request,
    @Query({ schema: AdminNoticesQuerySchema }) input: z.infer<typeof AdminNoticesQuerySchema>,
  ) {
    return this.service.adminList(request, input);
  }
  @Get(':id')
  @ApiOperation({ operationId: 'getAdminNotice' })
  @ApiOkResponse({ standardSchema: AdminNoticeResponseSchema })
  @SerializeOptions({ schema: AdminNoticeResponseSchema })
  detail(
    @Req() request: Request,
    @Param({ schema: NotificationIdSchema }) { id }: z.infer<typeof NotificationIdSchema>,
  ) {
    return this.service.adminDetail(request, id);
  }
  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: 'createAdminNotice' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminNoticeResponseSchema })
  @SerializeOptions({ schema: AdminNoticeResponseSchema })
  create(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: CreateAdminNoticeSchema }) input: z.infer<typeof CreateAdminNoticeSchema>,
  ) {
    return this.service.create(request, response, input);
  }
  @Post(':id/retry')
  @HttpCode(200)
  @ApiOperation({ operationId: 'retryAdminNotice' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: AdminNoticeResponseSchema })
  @SerializeOptions({ schema: AdminNoticeResponseSchema })
  retry(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: NotificationIdSchema }) { id }: z.infer<typeof NotificationIdSchema>,
    @Body({ schema: RetryAdminNoticeSchema }) input: z.infer<typeof RetryAdminNoticeSchema>,
  ) {
    return this.service.retry(request, response, id, input);
  }
}
