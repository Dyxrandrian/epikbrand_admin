import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { PaginationQueryDto } from '../../dto/index.js';
import type { SetCompensationDto } from '../../dto/payroll/salary.dto.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import { toCompensation } from '../../mapper/payroll.mapper.js';
import { CompensationRepository } from '../../repository/compensation.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class CompensationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly employees: CompensationRepository,
    private readonly audit: AuditService,
  ) {}

  /** Chaque consultation est journalisée avant de renvoyer les données. */
  async list(admin: AuthenticatedUser, query: PaginationQueryDto) {
    const result = await this.employees.list(admin.companyId, query);
    await this.audit.record({
      action: AuditAction.VIEW,
      entityType: AuditEntityType.SALARY,
      companyId: admin.companyId,
      userId: admin.id,
      changes: { after: { scope: 'compensations', result_count: result.items.length } },
    });
    return result.map(toCompensation);
  }

  async set(admin: AuthenticatedUser, userId: string, dto: SetCompensationDto) {
    const { companyId } = admin;

    await this.dataSource.transaction(async (manager) => {
      const before = await this.employees.getOne(companyId, userId, manager); // 404
      const patch = { baseSalary: dto.base_salary, dependentsCount: dto.dependents_count };
      if (patch.baseSalary === undefined && patch.dependentsCount === undefined) return;

      await this.employees.set(companyId, userId, patch, manager);

      await this.audit.record(
        {
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.USER,
          entityId: userId,
          companyId,
          userId: admin.id,
          changes: {
            before: { base_salary: before.baseSalary, dependents_count: before.dependentsCount },
            after: {
              base_salary: patch.baseSalary !== undefined ? patch.baseSalary : before.baseSalary,
              dependents_count: patch.dependentsCount ?? before.dependentsCount,
            },
          },
        },
        manager,
      );
    });

    return toCompensation(await this.employees.getOne(companyId, userId));
  }
}