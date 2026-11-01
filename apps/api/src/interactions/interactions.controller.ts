import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Put,
  Query,
  Req,
  SerializeOptions,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  InteractionCommandSchema,
  ErrorResponseSchema,
  FavoritesQuerySchema,
  FavoritesResponseSchema,
  InteractionBatchQuerySchema,
  InteractionResponseSchema,
  OwnInteractionsResponseSchema,
  PersonaIdSchema,
} from '@personamarket/contracts';
import type { Request } from 'express';
import type { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard.js';
import { InteractionsService } from './interactions.service.js';

@ApiTags('interactions')
@Controller()
@UseGuards(AuthGuard)
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
export class InteractionsController {
  constructor(@Inject(InteractionsService) readonly service: InteractionsService) {}
  @Get('me/persona-interactions')
  @ApiOperation({ operationId: 'getOwnPersonaInteractions' })
  @ApiOkResponse({ standardSchema: OwnInteractionsResponseSchema })
  @SerializeOptions({ schema: OwnInteractionsResponseSchema })
  states(
    @Req() request: Request,
    @Query({ schema: InteractionBatchQuerySchema })
    query: z.infer<typeof InteractionBatchQuerySchema>,
  ) {
    return this.service.states(request, query.ids);
  }
  @Get('me/favorites')
  @ApiOperation({ operationId: 'getOwnFavorites' })
  @ApiOkResponse({ standardSchema: FavoritesResponseSchema })
  @SerializeOptions({ schema: FavoritesResponseSchema })
  favorites(
    @Req() request: Request,
    @Query({ schema: FavoritesQuerySchema }) query: z.infer<typeof FavoritesQuerySchema>,
  ) {
    return this.service.favorites(request, query);
  }
  @Put('personas/:id/like')
  @ApiOperation({ operationId: 'likePersona' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: InteractionResponseSchema })
  @SerializeOptions({ schema: InteractionResponseSchema })
  like(
    @Req() request: Request,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Body({ schema: InteractionCommandSchema })
    _input: z.infer<typeof InteractionCommandSchema>,
  ) {
    void _input;
    return this.service.set(request, id, 'like', true);
  }
  @Delete('personas/:id/like')
  @ApiOperation({ operationId: 'unlikePersona' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: InteractionResponseSchema })
  @SerializeOptions({ schema: InteractionResponseSchema })
  unlike(
    @Req() request: Request,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Body({ schema: InteractionCommandSchema })
    _input: z.infer<typeof InteractionCommandSchema>,
  ) {
    void _input;
    return this.service.set(request, id, 'like', false);
  }
  @Put('personas/:id/favorite')
  @ApiOperation({ operationId: 'favoritePersona' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: InteractionResponseSchema })
  @SerializeOptions({ schema: InteractionResponseSchema })
  favorite(
    @Req() request: Request,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Body({ schema: InteractionCommandSchema })
    _input: z.infer<typeof InteractionCommandSchema>,
  ) {
    void _input;
    return this.service.set(request, id, 'favorite', true);
  }
  @Delete('personas/:id/favorite')
  @ApiOperation({ operationId: 'unfavoritePersona' })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ standardSchema: InteractionResponseSchema })
  @SerializeOptions({ schema: InteractionResponseSchema })
  unfavorite(
    @Req() request: Request,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Body({ schema: InteractionCommandSchema })
    _input: z.infer<typeof InteractionCommandSchema>,
  ) {
    void _input;
    return this.service.set(request, id, 'favorite', false);
  }
}
