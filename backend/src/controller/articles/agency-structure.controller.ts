import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { uuidPipe } from '../../dto/index.js';
import {
  CreateStructureElementDto,
  StructureListQueryDto,
  UpdateStructureElementDto,
} from '../../dto/structure/structure.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { AgencyStructureService } from '../../services/articles/agency-structure.service.js';

const MANAGERS = [UserRole.ADMIN, UserRole.MANAGER] as const;

@Controller('agency-structure')
export class AgencyStructureController {
  constructor(private readonly structure: AgencyStructureService) {}

  @Get()
  list(@CurrentUser() viewer: AuthenticatedUser, @Query() query: StructureListQueryDto) {
    return this.structure.list(viewer, query);
  }

  @Roles(...MANAGERS)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStructureElementDto) {
    return this.structure.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.structure.get(viewer, id);
  }

  @Roles(...MANAGERS)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateStructureElementDto,
  ) {
    return this.structure.update(user, id, dto);
  }

  @Roles(...MANAGERS)
  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.structure.remove(user, id);
  }
}