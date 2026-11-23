import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { uuidPipe } from '../../dto/index.js';
import { DecideRequestDto } from '../../dto/hr/decide-request.dto.js';
import {
  CreateTrainingRequestDto,
  TrainingListQueryDto,
  TrainingSummaryQueryDto,
} from '../../dto/hr/training.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, RateLimit, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { TrainingRequestService } from '../../services/hr/training-request.service.js';

const MANAGERS = [UserRole.ADMIN, UserRole.MANAGER] as const;

@Controller('training-requests')
export class TrainingRequestsController {
  constructor(private readonly trainings: TrainingRequestService) {}

  @Get()
  list(@CurrentUser() viewer: AuthenticatedUser, @Query() query: TrainingListQueryDto) {
    return this.trainings.list(viewer, query);
  }

  @RateLimit({ limit: 30, windowSeconds: 60, scope: 'user' })
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTrainingRequestDto) {
    return this.trainings.create(user, dto);
  }

  // Déclarée AVANT ':id'
  @Roles(...MANAGERS)
  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser, @Query() query: TrainingSummaryQueryDto) {
    return this.trainings.summary(user, query);
  }

  @Get(':id')
  get(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.trainings.get(viewer, id);
  }

  @Roles(...MANAGERS)
  @HttpCode(200)
  @Post(':id/approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: DecideRequestDto,
  ) {
    return this.trainings.approve(user, id, dto);
  }

  @Roles(...MANAGERS)
  @HttpCode(200)
  @Post(':id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: DecideRequestDto,
  ) {
    return this.trainings.reject(user, id, dto);
  }

  @HttpCode(200)
  @Post(':id/cancel')
  cancel(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: DecideRequestDto,
  ) {
    return this.trainings.cancel(viewer, id, dto);
  }
}