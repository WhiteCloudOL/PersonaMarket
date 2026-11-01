import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Req,
  Res,
  Inject,
  UseGuards,
  SerializeOptions,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiResponse, ApiHeader } from '@nestjs/swagger';
import {
  CreatePersonaSchema,
  PersonaDraftSchema,
  DraftResponseSchema,
  MyPersonasResponseSchema,
  TaxonomyResponseSchema,
  PersonaIdSchema,
  PaginationSchema,
  ErrorResponseSchema,
} from '@personamarket/contracts';
import type { z } from 'zod';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { PersonasService } from './personas.service.js';
@ApiTags('personas')
@ApiResponse({ status: 400, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 401, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 403, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 404, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 409, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 412, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 429, standardSchema: ErrorResponseSchema })
@ApiResponse({ status: 503, standardSchema: ErrorResponseSchema })
@UseGuards(AuthGuard)
@Controller()
export class PersonasController {
  constructor(@Inject(PersonasService) private readonly service: PersonasService) {}
  @Get('site/taxonomy')
  @ApiOperation({ operationId: 'getPersonaTaxonomy' })
  @ApiOkResponse({ standardSchema: TaxonomyResponseSchema })
  @SerializeOptions({ schema: TaxonomyResponseSchema })
  taxonomy() {
    return this.service.taxonomy();
  }
  @Post('me/personas')
  @HttpCode(200)
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOperation({ operationId: 'createOwnPersona' })
  @ApiOkResponse({ standardSchema: DraftResponseSchema })
  @SerializeOptions({ schema: DraftResponseSchema })
  create(
    @Req() request: Request,
    @Body({ schema: CreatePersonaSchema }) input: z.infer<typeof CreatePersonaSchema>,
  ) {
    return this.service.create(request, input);
  }
  @Get('me/personas')
  @ApiOperation({ operationId: 'listOwnPersonas' })
  @ApiOkResponse({ standardSchema: MyPersonasResponseSchema })
  @SerializeOptions({ schema: MyPersonasResponseSchema })
  list(
    @Req() request: Request,
    @Query({ schema: PaginationSchema }) query: z.infer<typeof PaginationSchema>,
  ) {
    return this.service.list(request, query.page, query.pageSize);
  }
  @Get('me/personas/:id/draft')
  @ApiOperation({ operationId: 'getOwnPersonaDraft' })
  @ApiOkResponse({ standardSchema: DraftResponseSchema })
  @SerializeOptions({ schema: DraftResponseSchema })
  async read(
    @Req() request: Request,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.service.read(request, id);
    response.setHeader('ETag', '"draft-' + value.meta.revision + '"');
    return value;
  }
  @Put('me/personas/:id/draft')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOperation({ operationId: 'saveOwnPersonaDraft' })
  @ApiOkResponse({ standardSchema: DraftResponseSchema })
  @SerializeOptions({ schema: DraftResponseSchema })
  async save(
    @Req() request: Request,
    @Param({ schema: PersonaIdSchema }) { id }: z.infer<typeof PersonaIdSchema>,
    @Body({ schema: PersonaDraftSchema }) payload: z.infer<typeof PersonaDraftSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.service.save(request, id, payload);
    response.setHeader('ETag', '"draft-' + value.meta.revision + '"');
    return value;
  }
}
