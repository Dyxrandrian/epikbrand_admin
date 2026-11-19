import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ClientListQueryDto,
  CreateClientDto,
  ForceQueryDto,
  UpdateClientDto,
} from '../../dto/clients/index.js';
import { uuidPipe } from '../../dto/index.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { ClientService } from '../../services/clients/client.service.js';

const MANAGERS = [UserRole.ADMIN, UserRole.MANAGER] as const;

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientService) {}

  @Get()
  list(@CurrentUser() viewer: AuthenticatedUser, @Query() query: ClientListQueryDto) {
    return this.clients.list(viewer, query);
  }

  @Roles(...MANAGERS)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClientDto,
    @Query() query: ForceQueryDto,
  ) {
    return this.clients.create(user, dto, query.force === true);
  }

  @Get(':id')
  get(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.clients.get(viewer, id);
  }

  @Roles(...MANAGERS)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clients.update(user, id, dto);
  }

  @Roles(...MANAGERS)
  @HttpCode(200)
  @Post(':id/archive')
  archive(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.clients.archive(user, id);
  }

  @Roles(...MANAGERS)
  @HttpCode(200)
  @Post(':id/restore')
  restore(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.clients.restore(user, id);
  }

  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentUser() admin: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.clients.remove(admin, id);
  }
}