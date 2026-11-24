import { Module } from '@nestjs/common';
import { DashboardsController } from '../controller/dashboards/dashboards.controller.js';
import { CrmDashboardRepository } from '../repository/dashboards/crm-dashboard.repository.js';
import { FinanceDashboardRepository } from '../repository/dashboards/finance-dashboard.repository.js';
import { HrDashboardRepository } from '../repository/dashboards/hr-dashboard.repository.js';
import { MyDashboardRepository } from '../repository/dashboards/my-dashboard.repository.js';
import { OperationsDashboardRepository } from '../repository/dashboards/operations-dashboard.repository.js';
import { CrmDashboardService } from '../services/dashboards/crm-dashboard.service.js';
import {
  DashboardCacheService,
  DashboardCacheStore,
  InMemoryDashboardCacheStore,
} from '../services/dashboards/dashboard-cache.js';
import { DashboardContextService } from '../services/dashboards/dashboard-support.js';
import { FinanceDashboardService } from '../services/dashboards/finance-dashboard.service.js';
import { HrDashboardService } from '../services/dashboards/hr-dashboard.service.js';
import { MonthlyDashboardService } from '../services/dashboards/monthly-dashboard.service.js';
import { MyDashboardService } from '../services/dashboards/my-dashboard.service.js';
import { OperationsDashboardService } from '../services/dashboards/operations-dashboard.service.js';
import { CompanyModule } from './company.module.js';
import { HrModule } from './hr.module.js';
import { PayrollModule } from './payroll.module.js';
import { ProjectsModule } from './projects.module.js';

// AuditService vient d'un module global
@Module({
  imports: [CompanyModule, ProjectsModule, PayrollModule, HrModule],
  controllers: [DashboardsController],
  providers: [
    { provide: DashboardCacheStore, useClass: InMemoryDashboardCacheStore },
    DashboardCacheService,
    DashboardContextService,
    FinanceDashboardRepository,
    OperationsDashboardRepository,
    CrmDashboardRepository,
    HrDashboardRepository,
    MyDashboardRepository,
    MonthlyDashboardService,
    FinanceDashboardService,
    OperationsDashboardService,
    CrmDashboardService,
    HrDashboardService,
    MyDashboardService,
  ],
})
export class DashboardsModule {}