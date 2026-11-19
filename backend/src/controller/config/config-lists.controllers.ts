import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateExpenseCategoryDto,
  CreateLabelDto,
  CreateLeaveTypeDto,
  CreateNamedItemDto,
  ReassignQueryDto,
  UpdateExpenseCategoryDto,
  UpdateLabelDto,
  UpdateLeaveTypeDto,
  UpdateNamedItemDto,
} from '../../dto/config/index.js';
import { PaginationQueryDto, uuidPipe } from '../../dto/index.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import {
  ArticleCategoryService,
  ArticleSectionService,
  ExpenseCategoryService,
  LabelService,
  LeaveTypeService,
  StructureElementTypeService,
} from '../../services/config/config-lists.services.js';

// Lecture : tous les rôles (aucun @Roles). Écriture : admin et manager.
const WRITERS = [UserRole.ADMIN, UserRole.MANAGER] as const;

@Controller('leave-types')
export class LeaveTypesController {
  constructor(private readonly service: LeaveTypeService) {}

  @Get()
  list(@CurrentUser('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.service.list(companyId, query);
  }

  @Roles(...WRITERS)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLeaveTypeDto) {
    return this.service.create(user, dto);
  }

  @Roles(...WRITERS)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateLeaveTypeDto,
  ) {
    return this.service.update(user, id, dto);
  }

  // Pas de reassign_to ici : un type de congé utilisé ne se supprime pas (409)
  @Roles(...WRITERS)
  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.service.remove(user, id);
  }
}

@Controller('article-categories')
export class ArticleCategoriesController {
  constructor(private readonly service: ArticleCategoryService) {}

  @Get()
  list(@CurrentUser('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.service.list(companyId, query);
  }

  @Roles(...WRITERS)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNamedItemDto) {
    return this.service.create(user, dto);
  }

  @Roles(...WRITERS)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateNamedItemDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Roles(...WRITERS)
  @HttpCode(204)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Query() query: ReassignQueryDto,
  ) {
    return this.service.remove(user, id, query.reassign_to);
  }
}

@Controller('article-sections')
export class ArticleSectionsController {
  constructor(private readonly service: ArticleSectionService) {}

  @Get()
  list(@CurrentUser('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.service.list(companyId, query);
  }

  @Roles(...WRITERS)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNamedItemDto) {
    return this.service.create(user, dto);
  }

  @Roles(...WRITERS)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateNamedItemDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Roles(...WRITERS)
  @HttpCode(204)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Query() query: ReassignQueryDto,
  ) {
    return this.service.remove(user, id, query.reassign_to);
  }
}

@Controller('structure-element-types')
export class StructureElementTypesController {
  constructor(private readonly service: StructureElementTypeService) {}

  @Get()
  list(@CurrentUser('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.service.list(companyId, query);
  }

  @Roles(...WRITERS)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateNamedItemDto) {
    return this.service.create(user, dto);
  }

  @Roles(...WRITERS)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateNamedItemDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Roles(...WRITERS)
  @HttpCode(204)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Query() query: ReassignQueryDto,
  ) {
    return this.service.remove(user, id, query.reassign_to);
  }
}

@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoryService) {}

  @Get()
  list(@CurrentUser('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.service.list(companyId, query);
  }

  @Roles(...WRITERS)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExpenseCategoryDto) {
    return this.service.create(user, dto);
  }

  @Roles(...WRITERS)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateExpenseCategoryDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Roles(...WRITERS)
  @HttpCode(204)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Query() query: ReassignQueryDto,
  ) {
    return this.service.remove(user, id, query.reassign_to);
  }
}

@Controller('labels')
export class LabelsController {
  constructor(private readonly service: LabelService) {}

  @Get()
  list(@CurrentUser('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.service.list(companyId, query);
  }

  @Roles(...WRITERS)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLabelDto) {
    return this.service.create(user, dto);
  }

  @Roles(...WRITERS)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateLabelDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Roles(...WRITERS)
  @HttpCode(204)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Query() query: ReassignQueryDto,
  ) {
    return this.service.remove(user, id, query.reassign_to);
  }
}