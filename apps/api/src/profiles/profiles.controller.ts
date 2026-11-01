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
import type { Request, Response } from 'express';
import {
  ErrorResponseSchema,
  OwnProfileResponseSchema,
  SaveProfileSchema,
  SubmitProfileSchema,
  WithdrawProfileSchema,
  ReviewProfileSchema,
  SetProfileVisibilitySchema,
  ProfileSubmissionIdSchema,
  ProfileOwnerParamsSchema,
  CreatorParamsSchema,
  CreatorAvatarParamsSchema,
  ProfileHistoryQuerySchema,
  ProfileHistoryResponseSchema,
  ProfileRecordsResponseSchema,
  ProfileSubmissionResponseSchema,
  ProfileModerationQuerySchema,
  ModerationProfileResponseSchema,
  ModerationProfilesResponseSchema,
  ProfileVisibilityResponseSchema,
  PublicCreatorResponseSchema,
  PublicPersonaListResponseSchema,
  CreatorPersonasQuerySchema,
  type SaveProfile,
  type SubmitProfile,
  type WithdrawProfile,
  type ReviewProfile,
  type SetProfileVisibility,
  type ProfileHistoryQuery,
  type ProfileModerationQuery,
  type CreatorPersonasQuery,
} from '@personamarket/contracts';
import { AuthGuard } from '../auth/auth.guard.js';
import { ProfilesService } from './profiles.service.js';

@Controller('me/profile')
@UseGuards(AuthGuard)
@ApiTags('profiles')
@ApiHeader({ name: 'X-Expected-Account', required: false })
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class ProfilesController {
  constructor(@Inject(ProfilesService) readonly service: ProfilesService) {}
  @Get()
  @ApiOperation({ operationId: 'getOwnProfile' })
  @ApiOkResponse({ standardSchema: OwnProfileResponseSchema })
  @SerializeOptions({ schema: OwnProfileResponseSchema })
  own(@Req() request: Request) {
    return this.service.own(request);
  }
  @Get('records')
  @ApiOperation({ operationId: 'listOwnProfileRecords' })
  @ApiOkResponse({ standardSchema: ProfileRecordsResponseSchema })
  @SerializeOptions({ schema: ProfileRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Query({ schema: ProfileHistoryQuerySchema }) input: ProfileHistoryQuery,
  ) {
    return this.service.records(request, input);
  }
  @Put()
  @ApiOperation({ operationId: 'saveOwnProfile' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: OwnProfileResponseSchema })
  @SerializeOptions({ schema: OwnProfileResponseSchema })
  save(@Req() request: Request, @Body({ schema: SaveProfileSchema }) input: SaveProfile) {
    return this.service.save(request, input);
  }
  @Get('submissions')
  @ApiOperation({ operationId: 'listOwnProfileSubmissions' })
  @ApiOkResponse({ standardSchema: ProfileHistoryResponseSchema })
  @SerializeOptions({ schema: ProfileHistoryResponseSchema })
  history(
    @Req() request: Request,
    @Query({ schema: ProfileHistoryQuerySchema }) input: ProfileHistoryQuery,
  ) {
    return this.service.history(request, input);
  }
  @Get('submissions/:id')
  @ApiOperation({ operationId: 'getOwnProfileSubmission' })
  @ApiOkResponse({ standardSchema: ProfileSubmissionResponseSchema })
  @SerializeOptions({ schema: ProfileSubmissionResponseSchema })
  submission(
    @Req() request: Request,
    @Param({ schema: ProfileSubmissionIdSchema }) { id }: { id: string },
  ) {
    return this.service.submission(request, id);
  }
  @Post('submissions')
  @HttpCode(200)
  @ApiOperation({ operationId: 'submitOwnProfile' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: ProfileSubmissionResponseSchema })
  @SerializeOptions({ schema: ProfileSubmissionResponseSchema })
  submit(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body({ schema: SubmitProfileSchema }) input: SubmitProfile,
  ) {
    return this.service.submit(request, response, input);
  }
  @Post('submissions/:id/withdraw')
  @HttpCode(200)
  @ApiOperation({ operationId: 'withdrawOwnProfileSubmission' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: ProfileSubmissionResponseSchema })
  @SerializeOptions({ schema: ProfileSubmissionResponseSchema })
  withdraw(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: ProfileSubmissionIdSchema }) { id }: { id: string },
    @Body({ schema: WithdrawProfileSchema }) input: WithdrawProfile,
  ) {
    return this.service.withdraw(request, response, id, input);
  }
}

@Controller('admin/profiles')
@UseGuards(AuthGuard)
@ApiTags('profile-moderation')
@ApiHeader({ name: 'X-Expected-Account', required: false })
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class ProfileModerationController {
  constructor(@Inject(ProfilesService) readonly service: ProfilesService) {}
  @Get(':userId/records')
  @ApiOperation({ operationId: 'listModerationProfileRecords' })
  @ApiOkResponse({ standardSchema: ProfileRecordsResponseSchema })
  @SerializeOptions({ schema: ProfileRecordsResponseSchema })
  records(
    @Req() request: Request,
    @Param({ schema: ProfileOwnerParamsSchema }) { userId }: { userId: string },
    @Query({ schema: ProfileHistoryQuerySchema }) input: ProfileHistoryQuery,
  ) {
    return this.service.records(request, input, userId);
  }
  @Get('submissions')
  @ApiOperation({ operationId: 'listProfileModeration' })
  @ApiOkResponse({ standardSchema: ModerationProfilesResponseSchema })
  @SerializeOptions({ schema: ModerationProfilesResponseSchema })
  list(
    @Req() request: Request,
    @Query({ schema: ProfileModerationQuerySchema }) input: ProfileModerationQuery,
  ) {
    return this.service.adminList(request, input);
  }
  @Get('submissions/:id')
  @ApiOperation({ operationId: 'getProfileModeration' })
  @ApiOkResponse({ standardSchema: ModerationProfileResponseSchema })
  @SerializeOptions({ schema: ModerationProfileResponseSchema })
  read(
    @Req() request: Request,
    @Param({ schema: ProfileSubmissionIdSchema }) { id }: { id: string },
  ) {
    return this.service.admin(request, id);
  }
  @Post('submissions/:id/review')
  @HttpCode(200)
  @ApiOperation({ operationId: 'reviewProfileSubmission' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: ModerationProfileResponseSchema })
  @SerializeOptions({ schema: ModerationProfileResponseSchema })
  review(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: ProfileSubmissionIdSchema }) { id }: { id: string },
    @Body({ schema: ReviewProfileSchema }) input: ReviewProfile,
  ) {
    return this.service.review(request, response, id, input);
  }
  @Post(':userId/visibility')
  @HttpCode(200)
  @ApiOperation({ operationId: 'setProfileVisibility' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ standardSchema: ProfileVisibilityResponseSchema })
  @SerializeOptions({ schema: ProfileVisibilityResponseSchema })
  visibility(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: ProfileOwnerParamsSchema }) { userId }: { userId: string },
    @Body({ schema: SetProfileVisibilitySchema }) input: SetProfileVisibility,
  ) {
    return this.service.visibility(request, response, userId, input);
  }
  @Get('submissions/:id/avatar')
  @ApiOperation({ operationId: 'getProfileSubmissionAvatar' })
  @ApiOkResponse({
    description: '经鉴权读取待审或历史资料头像',
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  avatar(
    @Req() request: Request,
    @Res() response: Response,
    @Param({ schema: ProfileSubmissionIdSchema }) { id }: { id: string },
  ) {
    return this.service.adminAvatar(request, response, id);
  }
}

@Controller('users')
@ApiTags('public-creators')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
export class PublicCreatorsController {
  constructor(@Inject(ProfilesService) readonly service: ProfilesService) {}
  @Get(':username/personas')
  @ApiOperation({ operationId: 'listCreatorPersonas' })
  @ApiOkResponse({ standardSchema: PublicPersonaListResponseSchema })
  @SerializeOptions({ schema: PublicPersonaListResponseSchema })
  personas(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: CreatorParamsSchema }) { username }: { username: string },
    @Query({ schema: CreatorPersonasQuerySchema }) input: CreatorPersonasQuery,
  ) {
    return this.service.creatorPersonas(request, response, username, input);
  }
  @Get(':username')
  @ApiOperation({ operationId: 'getCreator' })
  @ApiOkResponse({ standardSchema: PublicCreatorResponseSchema })
  @SerializeOptions({ schema: PublicCreatorResponseSchema })
  creator(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param({ schema: CreatorParamsSchema }) { username }: { username: string },
  ) {
    return this.service.creator(request, response, username);
  }
  @Get(':username/avatar/:id')
  @ApiOperation({ operationId: 'getCreatorAvatar' })
  @ApiOkResponse({
    description: '仅当前可公开的获批资料头像',
    content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } },
  })
  avatar(
    @Req() request: Request,
    @Res() response: Response,
    @Param({ schema: CreatorAvatarParamsSchema })
    { username, id }: { username: string; id: string },
  ) {
    return this.service.publicAvatar(request, response, username, id);
  }
}
