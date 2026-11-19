import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { PageQueryDto, uuidPipe } from '../../dto/index.js';
import { CreateTaskCommentDto, UpdateTaskCommentDto } from '../../dto/tasks/index.js';
import { CurrentUser, RateLimit } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { TaskCommentService } from '../../services/tasks/task-comment.service.js';

@Controller()
export class TaskCommentsController {
  constructor(private readonly comments: TaskCommentService) {}

  @Get('tasks/:taskId/comments')
  list(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('taskId', uuidPipe('taskId')) taskId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.comments.list(viewer, taskId, query);
  }

  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @Post('tasks/:taskId/comments')
  create(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('taskId', uuidPipe('taskId')) taskId: string,
    @Body() dto: CreateTaskCommentDto,
  ) {
    return this.comments.create(viewer, taskId, dto);
  }

  @Patch('task-comments/:id')
  update(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdateTaskCommentDto,
  ) {
    return this.comments.update(viewer, id, dto);
  }

  @HttpCode(204)
  @Delete('task-comments/:id')
  remove(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.comments.remove(viewer, id);
  }
}