import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogController } from '../controller/audit/audit-log.controller.js';
import { AuditLog } from '../entities/audit-log.entity.js';
import { RequestContextInterceptor } from '../interceptors/request-context.interceptor.js';
import { AuditLogRepository } from '../repository/audit-log.repository.js';
import { AuditService } from '../services/audit/audit.service.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditLogController],
  providers: [
    AuditLogRepository,
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}