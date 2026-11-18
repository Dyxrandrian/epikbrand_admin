import { IsEnum, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import { PageQueryDto } from '../pagination-query.dto.js';

export class AuditLogListQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(AuditEntityType, {
    message: `entity_type doit être l'un de : ${Object.values(AuditEntityType).join(', ')}.`,
  })
  entity_type?: AuditEntityType;

  @IsOptional()
  @IsUUID('all', { message: 'entity_id doit être un UUID valide.' })
  entity_id?: string;

  @IsOptional()
  @IsUUID('all', { message: 'user_id doit être un UUID valide.' })
  user_id?: string;

  @IsOptional()
  @IsEnum(AuditAction, {
    message: `action doit être l'une de : ${Object.values(AuditAction).join(', ')}.`,
  })
  action?: AuditAction;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from doit être une date ISO 8601.' })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to doit être une date ISO 8601.' })
  to?: string;
}