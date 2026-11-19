import { IsOptional } from 'class-validator';
import {
  ClientAddress,
  ClientCompanyName,
  ClientContactName,
  ClientEmail,
  ClientPhone,
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
  @ClientAddress()
  address?: string | null;
}