import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { LeaveBalanceQueryDto, SetLeaveBalanceDto } from '../../dto/hr/leave.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { LeaveBalanceService } from '../../services/hr/leave-balance.service.js';

@Controller('leave-balances')
export class LeaveBalancesController {
  constructor(private readonly balances: LeaveBalanceService) {}

  @Get()
  list(@CurrentUser() viewer: AuthenticatedUser, @Query() query: LeaveBalanceQueryDto) {
    return this.balances.list(viewer, query);
  }

  @Roles(UserRole.ADMIN)
  @Put()
  set(@CurrentUser() admin: AuthenticatedUser, @Body() dto: SetLeaveBalanceDto) {
    return this.balances.set(admin, dto);
  }
}