import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { InvoiceDocumentType, InvoicePaymentStatus } from '../../enums/app.enums.js';
import { PaginationQueryDto } from '../pagination-query.dto.js';
import { splitCsv, toBoolean } from '../transforms.js';
import { DateOnlyField } from './invoice-fields.js';

export class InvoiceListQueryDto extends PaginationQueryDto {
  /** Exemple : type=invoice,quote */
  @IsOptional()
  @Transform(splitCsv)
  @IsEnum(InvoiceDocumentType, {
    each: true,
    message: `type doit contenir : ${Object.values(InvoiceDocumentType).join(', ')}.`,
  })
  type?: InvoiceDocumentType[];

  /** Exemple : status=sent,overdue */
  @IsOptional()
  @Transform(splitCsv)
  @IsEnum(InvoicePaymentStatus, {
    each: true,
    message: `status doit contenir : ${Object.values(InvoicePaymentStatus).join(', ')}.`,
  })
  status?: InvoicePaymentStatus[];

  @IsOptional()
  @IsUUID('all', { message: 'client_id doit être un UUID valide.' })
  client_id?: string;

  @IsOptional()
  @IsUUID('all', { message: 'project_id doit être un UUID valide.' })
  project_id?: string;

  @IsOptional()
  @DateOnlyField()
  issue_from?: string;

  @IsOptional()
  @DateOnlyField()
  issue_to?: string;

  @IsOptional()
  @DateOnlyField()
  due_from?: string;

  @IsOptional()
  @DateOnlyField()
  due_to?: string;

  /** true : factures envoyées dont l'échéance est dépassée et le solde non nul. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'overdue doit valoir true ou false.' })
  overdue?: boolean;

  /** true : factures émises non soldées. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'unpaid doit valoir true ou false.' })
  unpaid?: boolean;
}