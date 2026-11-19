import { IsInt, IsOptional, Min, ValidateIf } from 'class-validator';
import {
  ClientAddress,
  ClientCompanyName,
  ClientContactName,
  ClientEmail,
  ClientPhone,
} from './client-fields.js';

export class UpdateClientDto {
  @IsInt({ message: 'La version doit être un entier (celle reçue lors de la lecture).' })
  @Min(1, { message: 'La version est invalide.' })
  version: number;

  @ValidateIf((o: UpdateClientDto) => o.company_name !== undefined)
  @ClientCompanyName()
  company_name?: string;

  @IsOptional()
  @ClientContactName()
  contact_name?: string | null;

  @IsOptional()
  @ClientEmail()
  email?: string | null;

  @IsOptional()
  @ClientPhone()
  phone?: string | null;

  @IsOptional()
  @ClientAddress()
  address?: string | null;
}