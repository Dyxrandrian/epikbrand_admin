import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { uuidPipe } from '../../dto/index.js';
import { DecideRequestDto } from '../../dto/hr/decide-request.dto.js';
import {
  CreateLeaveRequestDto,
  LeaveCalendarQueryDto,
  LeaveListQueryDto,
} from '../../dto/hr/leave.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, RateLimit, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { LeaveRequestService } from '../../services/hr/leave-request.service.js';

const MANAGERS = [UserRole.ADMIN, UserRole.MANAGER] as const;

@Controller('leave-requests')
export class LeaveRequestsController {
  constructor(private readonly leaves: LeaveRequestService) {}

  @Get()
  list(@CurrentUser() viewer: AuthenticatedUser, @Query() query: LeaveListQueryDto) {
    return this.leaves.list(viewer, query);
  }

  @RateLimit({ limit: 30, windowSeconds: 60, scope: 'user' })
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLeaveRequestDto) {
    return this.leaves.create(user, dto);
  }

  // Déclarée AVANT ':id'
  @Get('calendar')
  calendar(@CurrentUser() viewer: AuthenticatedUser, @Query() query: LeaveCalendarQueryDto) {
    return this.leaves.calendar(viewer, query);
  }

  @Get(':id')
  get(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.leaves.get(viewer, id);
  }

  @Roles(...MANAGERS)
  @HttpCode(200)
  @Post(':id/approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: DecideRequestDto,
  ) {
    return this.leaves.approve(user, id, dto);
  }

  @Roles(...MANAGERS)
  @HttpCode(200)
  @Post(':id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: DecideRequestDto,
  ) {
    return this.leaves.reject(user, id, dto);
  }

  // Les droits fins (demandeur ou manager, selon le statut) sont dans le service
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: DecideRequestDto,
  ) {
    return this.leaves.cancel(viewer, id, dto);
  }
}