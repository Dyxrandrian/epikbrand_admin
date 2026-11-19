import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskCommentsController } from '../controller/tasks/task-comments.controller.js';
import { TasksController } from '../controller/tasks/tasks.controller.js';
import { TaskComment } from '../entities/task-comment.entity.js';
import { Task } from '../entities/task.entity.js';
import { TaskCommentRepository } from '../repository/task-comment.repository.js';
import { TaskRepository } from '../repository/task.repository.js';
import { TaskAssignmentService } from '../services/tasks/task-assignment.service.js';
import { TaskCommentService } from '../services/tasks/task-comment.service.js';
import { TaskService } from '../services/tasks/task.service.js';
import { CompanyModule } from './company.module.js';
import { ProjectsModule } from './projects.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Task, TaskComment]), ProjectsModule, CompanyModule],
  controllers: [TasksController, TaskCommentsController],
  providers: [
    TaskRepository,
    TaskCommentRepository,
    TaskService,
    TaskAssignmentService,
    TaskCommentService,
  ],
  exports: [TaskRepository],
})
export class TasksModule {}