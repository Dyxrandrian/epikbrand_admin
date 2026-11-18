import { Controller, Get, Query } from '@nestjs/common';
import { AuditLogListQueryDto } from '../../dto/audit/audit-log-list-query.dto.js';
import { UserRole } from '../../enums/app.enums.js';
import { toAuditLog } from '../../mapper/audit-log.mapper.js';
import { CurrentUser, Roles } from '../../security/index.js';
import { AuditService } from '../../services/audit/audit.service.js';

@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly audit: AuditService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  async list(
    @CurrentUser('companyId') companyId: string,
    @Query() query: AuditLogListQueryDto,
  ) {
    const result = await this.audit.list(companyId, query);
    return result.map(toAuditLog);
  }
}