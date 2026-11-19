import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ConfirmQueryDto, uuidPipe } from '../../dto/index.js';
import {
  ChangeProjectStatusDto,
  CreateProjectDto,
  DuplicateProjectDto,
  ProjectListQueryDto,
  UpdateProjectDto,
} from '../../dto/projects/index.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, RateLimit, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { ProjectService } from '../../services/projects/project.service.js';

const MANAGERS = [UserRole.ADMIN, UserRole.MANAGER] as const;

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectService) {}

  @Get()
  list(@CurrentUser() viewer: AuthenticatedUser, @Query() query: ProjectListQueryDto) {
    return this.projects.list(viewer, query);
  }

  @Roles(...MANAGERS)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.projects.get(viewer, id);
  }

  @Roles(...MANAGERS)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(user, id, dto);
  }

  @Roles(...MANAGERS)
  @Patch(':id/status')
  changeStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: ChangeProjectStatusDto,
    @Query() query: ConfirmQueryDto,
  ) {
    return this.projects.changeStatus(user, id, dto, query.confirm === true);
  }

  @Roles(...MANAGERS)
  @HttpCode(200)
  @Post(':id/archive')
  archive(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.projects.archive(user, id);
  }

  @Roles(...MANAGERS)
  @HttpCode(200)
  @Post(':id/restore')
  restore(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.projects.restore(user, id);
  }

  @Roles(...MANAGERS)
  @RateLimit({ limit: 30, windowSeconds: 3600, scope: 'user' })
  @Post(':id/duplicate')
  duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: DuplicateProjectDto,
  ) {
    return this.projects.duplicate(user, id, dto);
  }

  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  @Delete(':id')
  remove(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Query() query: ConfirmQueryDto,
  ) {
    return this.projects.remove(admin, id, query.confirm === true);
  }
}