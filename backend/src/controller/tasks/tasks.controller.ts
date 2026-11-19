import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { uuidPipe } from '../../dto/index.js';
import {
  AddAssigneesDto,
  BulkTasksDto,
  CreateTaskDto,
  DuplicateTaskDto,
  MoveTaskDto,
  SetLabelsDto,
  TaskCalendarQueryDto,
  TaskKanbanQueryDto,
  TaskListQueryDto,
  TaskMineQueryDto,
  UpdateTaskDto,
} from '../../dto/tasks/index.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, RateLimit, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { TaskAssignmentService } from '../../services/tasks/task-assignment.service.js';
import { TaskService } from '../../services/tasks/task.service.js';

const MANAGERS = [UserRole.ADMIN, UserRole.MANAGER] as const;

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TaskService,
    private readonly assignments: TaskAssignmentService,
  ) {}

  @Get()
  list(@CurrentUser() viewer: AuthenticatedUser, @Query() query: TaskListQueryDto) {
    return this.tasks.list(viewer, query);
  }

  @Roles(...MANAGERS)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTaskDto) {
    return this.tasks.create(user, dto);
  }

  // ----- Routes statiques : AVANT ':id' -----

  @Get('kanban')
  kanban(@CurrentUser() viewer: AuthenticatedUser, @Query() query: TaskKanbanQueryDto) {
    return this.tasks.kanban(viewer, query);
  }

  @Get('calendar')
  calendar(@CurrentUser() viewer: AuthenticatedUser, @Query() query: TaskCalendarQueryDto) {
    return this.tasks.calendar(viewer, query);
  }

  @Get('mine')
  mine(@CurrentUser() viewer: AuthenticatedUser, @Query() query: TaskMineQueryDto) {
    return this.tasks.mine(viewer, query);
  }

  @Roles(...MANAGERS)
  @RateLimit({ limit: 30, windowSeconds: 60, scope: 'user' })
  @HttpCode(200)
  @Post('bulk')
  bulk(@CurrentUser() user: AuthenticatedUser, @Body() dto: BulkTasksDto) {
    return this.assignments.bulk(user, dto);
  }

  // ----- Une tâche -----

  @Get(':id')
  get(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.tasks.get(viewer, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(viewer, id, dto);
  }

  @Patch(':id/move')
  move(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: MoveTaskDto,
  ) {
    return this.tasks.move(viewer, id, dto);
  }

  @Roles(...MANAGERS)
  @HttpCode(200)
  @Post(':id/archive')
  archive(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.tasks.archive(user, id);
  }

  @Roles(...MANAGERS)
  @HttpCode(200)
  @Post(':id/restore')
  restore(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.tasks.restore(user, id);
  }

  @Roles(...MANAGERS)
  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @Post(':id/duplicate')
  duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: DuplicateTaskDto,
  ) {
    return this.tasks.duplicate(user, id, dto);
  }

  // ----- Responsables et étiquettes -----

  @Roles(...MANAGERS)
  @Post(':id/assignees')
  addAssignees(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: AddAssigneesDto,
  ) {
    return this.assignments.addAssignees(user, id, dto);
  }

  @Roles(...MANAGERS)
  @HttpCode(204)
  @Delete(':id/assignees/:userId')
  removeAssignee(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Param('userId', uuidPipe('userId')) userId: string,
  ) {
    return this.assignments.removeAssignee(user, id, userId);
  }

  @Roles(...MANAGERS)
  @Put(':id/labels')
  setLabels(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: SetLabelsDto,
  ) {
    return this.assignments.setLabels(user, id, dto);
  }
}