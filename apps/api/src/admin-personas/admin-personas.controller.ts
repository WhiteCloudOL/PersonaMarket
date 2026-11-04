import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  SerializeOptions,
  UseGuards,
  Body,
  Post,
  Res,
  HttpCode,
  Put,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AdminPersonaIdSchema,
  DeleteAdminPersonaSchema,
  AdminPersonaResponseSchema,
  AdminPersonasQuerySchema,
  AdminPersonasResponseSchema,
  ErrorResponseSchema,
  PersonaModerationSchema,
  AuthNoticeResponseSchema,
  SetPersonaCurationSchema,
  AdminPersonaBulkRequestSchema,
  AdminPersonaBulkResponseSchema,
  AdminPersonaRecordsQuerySchema,
  AdminPersonaRecordsResponseSchema,
} from '@personamarket/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { AdminPersonasService } from './admin-personas.service.js';

@ApiTags('persona-management')
@ApiHeader({
  name: 'X-Expected-Account',
  required: false,
  description: '仅核对实际会话，不授予身份或权限',
})
@Controller('admin/personas')
@UseGuards(AuthGuard)
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class AdminPersonasController {
  constructor(@Inject(AdminPersonasService) readonly service: AdminPersonasService) {}
  @Post('bulk')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOperation({
    operationId: 'bulkManagePersonas',
    summary: '按独立修订号和操作标识逐项管理人设',
  })
  @ApiOkResponse({ standardSchema: AdminPersonaBulkResponseSchema })
  @SerializeOptions({ schema: AdminPersonaBulkResponseSchema })
  bulk(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: AdminPersonaBulkRequestSchema })
    input: z.infer<typeof AdminPersonaBulkRequestSchema>,
  ) {
    return this.service.bulk(request, response, input);
  }
  @Get(':id/records')
  @ApiOperation({ operationId: 'getAdminPersonaRecords', summary: '分页读取人设的管理记录' })
  @ApiOkResponse({ standardSchema: AdminPersonaRecordsResponseSchema })
  @SerializeOptions({ schema: AdminPersonaRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Param({ schema: AdminPersonaIdSchema }) { id }: z.infer<typeof AdminPersonaIdSchema>,
    @Query({ schema: AdminPersonaRecordsQuerySchema })
    input: z.infer<typeof AdminPersonaRecordsQuerySchema>,
  ) {
    return this.service.records(request, id, input);
  }
  @Put(':id/curation')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'setPersonaCuration', summary: '核对人设状态后设置官方或精选标记' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  curate(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: AdminPersonaIdSchema }) { id }: z.infer<typeof AdminPersonaIdSchema>,
    @Body({ schema: SetPersonaCurationSchema }) input: z.infer<typeof SetPersonaCurationSchema>,
  ) {
    return this.service.curate(request, response, id, input);
  }
  @Post(':id/delete')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'deleteAdminPersona', summary: '核对修订后永久移除人设' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  delete(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: AdminPersonaIdSchema }) { id }: z.infer<typeof AdminPersonaIdSchema>,
    @Body({ schema: DeleteAdminPersonaSchema }) input: z.infer<typeof DeleteAdminPersonaSchema>,
  ) {
    return this.service.delete(request, response, id, input);
  }
  @Post(':id/moderation')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'moderatePersona', summary: '按已核对修订号下架或恢复人设' })
  @ApiOkResponse({ standardSchema: AuthNoticeResponseSchema })
  @SerializeOptions({ schema: AuthNoticeResponseSchema })
  moderate(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: AdminPersonaIdSchema }) { id }: z.infer<typeof AdminPersonaIdSchema>,
    @Body({ schema: PersonaModerationSchema }) input: z.infer<typeof PersonaModerationSchema>,
  ) {
    return this.service.moderate(request, response, id, input);
  }
  @Get()
  @ApiOperation({ operationId: 'getAdminPersonas', summary: '按归属与状态分页筛选人设管理元数据' })
  @ApiOkResponse({ standardSchema: AdminPersonasResponseSchema })
  @SerializeOptions({ schema: AdminPersonasResponseSchema })
  list(
    @Req() request: Request,
    @Query({ schema: AdminPersonasQuerySchema }) input: z.infer<typeof AdminPersonasQuerySchema>,
  ) {
    return this.service.list(request, input);
  }
  @Get(':id')
  @ApiOperation({ operationId: 'getAdminPersona', summary: '读取人设管理状态与版本指针' })
  @ApiOkResponse({ standardSchema: AdminPersonaResponseSchema })
  @SerializeOptions({ schema: AdminPersonaResponseSchema })
  detail(
    @Req() request: Request,
    @Param({ schema: AdminPersonaIdSchema }) { id }: z.infer<typeof AdminPersonaIdSchema>,
  ) {
    return this.service.detail(request, id);
  }
}
