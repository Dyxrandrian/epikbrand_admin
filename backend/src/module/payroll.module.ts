import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PayrollController } from '../controller/payroll/payroll.controller.js';
import { SalariesController } from '../controller/payroll/salaries.controller.js';
import { PayrollRule } from '../entities/payroll-rule.entity.js';
import { SalaryItem } from '../entities/salary-item.entity.js';
import { Salary } from '../entities/salary.entity.js';
import { User } from '../entities/user.entity.js';
import { CompensationRepository } from '../repository/compensation.repository.js';
import { PayrollRuleRepository } from '../repository/payroll-rule.repository.js';
import { SalaryRepository } from '../repository/salary.repository.js';
import { CompensationService } from '../services/payroll/compensation.service.js';
import { SalaryPdfService } from '../services/payroll/pdf/salary-pdf.service.js';
import { PayrollRuleService } from '../services/payroll/payroll-rule.service.js';
import { SalaryGenerationService } from '../services/payroll/salary-generation.service.js';
import { SalaryService } from '../services/payroll/salary.service.js';
import { CompanyModule } from './company.module.js';
import { FilesModule } from './files.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Salary, SalaryItem, PayrollRule, User]),
    CompanyModule,
    FilesModule,
  ],
  controllers: [PayrollController, SalariesController],
  providers: [
    SalaryRepository,
    PayrollRuleRepository,
    CompensationRepository,
    PayrollRuleService,
    CompensationService,
    SalaryService,
    SalaryGenerationService,
    SalaryPdfService,
  ],
  exports: [SalaryRepository],
})
export class PayrollModule {}