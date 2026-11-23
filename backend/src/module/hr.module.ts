import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeaveBalancesController } from '../controller/hr/leave-balances.controller.js';
import { LeaveRequestsController } from '../controller/hr/leave-requests.controller.js';
import { TrainingRequestsController } from '../controller/hr/training-requests.controller.js';
import { LeaveBalance } from '../entities/leave-balance.entity.js';
import { LeaveRequest } from '../entities/leave-request.entity.js';
import { LeaveType } from '../entities/leave-type.entity.js';
import { TrainingRequest } from '../entities/training-request.entity.js';
import { LeaveTypeRepository } from '../repository/config-lists.repositories.js';
import { LeaveBalanceRepository } from '../repository/leave-balance.repository.js';
import { LeaveRequestRepository } from '../repository/leave-request.repository.js';
import { TrainingRequestRepository } from '../repository/training-request.repository.js';
import { LeaveBalanceService } from '../services/hr/leave-balance.service.js';
import { LeaveRequestService } from '../services/hr/leave-request.service.js';
import { TrainingRequestService } from '../services/hr/training-request.service.js';
import { CompanyModule } from './company.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([LeaveRequest, LeaveBalance, TrainingRequest, LeaveType]),
    CompanyModule,
  ],
  controllers: [LeaveRequestsController, LeaveBalancesController, TrainingRequestsController],
  providers: [
    LeaveRequestRepository,
    LeaveBalanceRepository,
    TrainingRequestRepository,
    LeaveTypeRepository,
    LeaveBalanceService,
    LeaveRequestService,
    TrainingRequestService,
  ],
  exports: [LeaveRequestRepository, LeaveBalanceRepository, TrainingRequestRepository],
})
export class HrModule {}