import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { PaginationQueryDto, uuidPipe } from '../../dto/index.js';
import {
  CreatePayrollRuleDto,
  PayrollRuleListQueryDto,
  UpdatePayrollRuleDto,
} from '../../dto/payroll/payroll-rule.dto.js';
import { PayrollSummaryQueryDto, SetCompensationDto } from '../../dto/payroll/salary.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { CurrentUser, RateLimit, Roles } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { CompensationService } from '../../services/payroll/compensation.service.js';
import { PayrollRuleService } from '../../services/payroll/payroll-rule.service.js';
import { SalaryService } from '../../services/payroll/salary.service.js';

@Roles(UserRole.ADMIN)
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly rules: PayrollRuleService,
    private readonly compensation: CompensationService,
    private readonly salaries: SalaryService,
  ) {}

  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @Get('summary')
  summary(@CurrentUser() admin: AuthenticatedUser, @Query() query: PayrollSummaryQueryDto) {
    return this.salaries.summary(admin, query);
  }

  // ----- Rémunérations -----

  @RateLimit({ limit: 60, windowSeconds: 60, scope: 'user' })
  @Get('compensations')
  listCompensations(@CurrentUser() admin: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.compensation.list(admin, query);
  }

  @Put('compensations/:userId')
  setCompensation(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId', uuidPipe('userId')) userId: string,
    @Body() dto: SetCompensationDto,
  ) {
    return this.compensation.set(admin, userId, dto);
  }

  // ----- Règles de paie -----

  @Get('rules')
  listRules(@CurrentUser() admin: AuthenticatedUser, @Query() query: PayrollRuleListQueryDto) {
    return this.rules.list(admin, query);
  }

  @Post('rules')
  createRule(@CurrentUser() admin: AuthenticatedUser, @Body() dto: CreatePayrollRuleDto) {
    return this.rules.create(admin, dto);
  }

  /** Installation explicite du modèle de règles ; rien n'est jamais installé automatiquement. */
  @HttpCode(200)
  @Post('rules/presets/:presetId')
  applyPreset(@CurrentUser() admin: AuthenticatedUser, @Param('presetId') presetId: string) {
    return this.rules.applyPreset(admin, presetId);
  }

  @Patch('rules/:id')
  updateRule(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', uuidPipe('id')) id: string,
    @Body() dto: UpdatePayrollRuleDto,
  ) {
    return this.rules.update(admin, id, dto);
  }

  @HttpCode(204)
  @Delete('rules/:id')
  removeRule(@CurrentUser() admin: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.rules.remove(admin, id);
  }
}