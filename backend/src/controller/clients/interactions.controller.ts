import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { uuidPipe } from '../../dto/index.js';
import {
  CreateInteractionDto,
  InteractionFiltersDto,
  InteractionListQueryDto,
  UpdateInteractionDto,
} from '../../dto/interactions/index.js';
import { CurrentUser } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { InteractionService } from '../../services/clients/interaction.service.js';

@Controller()
export class InteractionsController {
  constructor(private readonly interactions: InteractionService) {}

  @Get('clients/:clientId/interactions')
  listForClient(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('clientId', uuidPipe('clientId')) clientId: string,
    @Query() query: InteractionFiltersDto,
  ) {
    return this.interactions.listForClient(viewer, clientId, query);
  }

  @Post('clients/:clientId/interactions')
  create(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('clientId', uuidPipe('clientId')) clientId: string,
    @Body() dto: CreateInteractionDto,
  ) {
    return this.interactions.create(viewer, clientId, dto);
  }

  @Get('interactions')
  list(@CurrentUser() viewer: AuthenticatedUser, @Query() query: InteractionListQueryDto) {
    return this.interactions.list(viewer, query);
  }

  @Patch('interactions/:id')
  update(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateInteractionDto,
  ) {
    return this.interactions.update(viewer, id, dto);
  }

  @HttpCode(204)
  @Delete('interactions/:id')
  remove(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.interactions.remove(viewer, id);
  }
}