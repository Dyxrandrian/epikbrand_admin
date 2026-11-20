import { IsEnum, IsOptional } from 'class-validator';
import { PaymentMethod } from '../../enums/app.enums.js';
import { DateOnlyField, MoneyField, TextField } from './invoice-fields.js';

const METHOD_MESSAGE = `Le moyen de paiement doit être l'un de : ${Object.values(PaymentMethod).join(', ')}.`;

export class CreatePaymentDto {
  @MoneyField('Le montant', 0.01)
  amount: number;

  /** Par défaut : aujourd'hui (fuseau de l'entreprise). */
  @IsOptional()
  @DateOnlyField()
  paid_at?: string;

  @IsEnum(PaymentMethod, { message: METHOD_MESSAGE })
  method: PaymentMethod;

  @IsOptional()
  @TextField('La référence', 100)
  reference?: string | null;

  @IsOptional()
  @TextField('Les notes', 1000)
  notes?: string | null;
}

/** Solde la facture : le montant est le restant dû, calculé par l'API. */
export class MarkPaidDto {
  @IsOptional()
  @DateOnlyField()
  paid_at?: string;

  @IsEnum(PaymentMethod, { message: METHOD_MESSAGE })
  method: PaymentMethod;

  @IsOptional()
  @TextField('La référence', 100)
  reference?: string | null;

  @IsOptional()
  @TextField('Les notes', 1000)
  notes?: string | null;
}