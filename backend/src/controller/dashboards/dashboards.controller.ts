import { Controller, Get, Query } from '@nestjs/common';
import { DashboardQueryDto } from '../../dto/dashboards/dashboard-query.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, RateLimit, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { CrmDashboardService } from '../../services/dashboards/crm-dashboard.service.js';
import { FinanceDashboardService } from '../../services/dashboards/finance-dashboard.service.js';
import { HrDashboardService } from '../../services/dashboards/hr-dashboard.service.js';
import { MonthlyDashboardService } from '../../services/dashboards/monthly-dashboard.service.js';
import { MyDashboardService } from '../../services/dashboards/my-dashboard.service.js';
import { OperationsDashboardService } from '../../services/dashboards/operations-dashboard.service.js';

// Les dashboards contiennent des montants et des données d'équipe : admin et manager.
// Seul « Mon espace » est ouvert à tous les rôles.
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
@Controller('dashboards')
export class DashboardsController {
  constructor(
    private readonly monthly: MonthlyDashboardService,
    private readonly finance: FinanceDashboardService,
    private readonly operations: OperationsDashboardService,
    private readonly crm: CrmDashboardService,
    private readonly hr: HrDashboardService,
    private readonly mine: MyDashboardService,
  ) {}

  @Get('monthly')
  monthlyBoard(@CurrentUser() viewer: AuthenticatedUser, @Query() query: DashboardQueryDto) {
    return this.monthly.get(viewer, query);
  }

  @Get('general')
  general(@CurrentUser() viewer: AuthenticatedUser, @Query() query: DashboardQueryDto) {
    return this.operations.general(viewer, query);
  }

  @Get('finance')
  financeBoard(@CurrentUser() viewer: AuthenticatedUser, @Query() query: DashboardQueryDto) {
    return this.finance.get(viewer, query);
  }

  @Get('projects')
  projects(@CurrentUser() viewer: AuthenticatedUser, @Query() query: DashboardQueryDto) {
    return this.operations.projects(viewer, query);
  }

  @Get('crm')
  crmBoard(@CurrentUser() viewer: AuthenticatedUser, @Query() query: DashboardQueryDto) {
    return this.crm.get(viewer, query);
  }

  @Get('hr')
  hrBoard(@CurrentUser() viewer: AuthenticatedUser, @Query() query: DashboardQueryDto) {
    return this.hr.get(viewer, query);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.COLLABORATOR)
  @Get('me')
  me(@CurrentUser() viewer: AuthenticatedUser, @Query() query: DashboardQueryDto) {
    return this.mine.get(viewer, query);
  }
}