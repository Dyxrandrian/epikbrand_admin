import { IsOptional } from 'class-validator';
import {
  ClientAddress,
  ClientCompanyName,
  ClientContactName,
  ClientEmail,
  ClientPhone,
  ClientTaxId,
} from './client-fields.js';

export class CreateClientDto {
  @ClientCompanyName()
  company_name: string;

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
  @ClientTaxId('Le NIF')
  nif?: string | null;

  @IsOptional()
  @ClientTaxId('Le STAT')
  stat?: string | null;

  @IsOptional()
  @ClientAddress()
  address?: string | null;
}