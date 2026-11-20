import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaymentMethod } from '../../enums/app.enums.js';
import { DateOnlyField } from '../invoices/invoice-fields.js';

export class PayExpenseDto {
  /** Par défaut : aujourd'hui. Jamais dans le futur. */
  @IsOptional()
  @DateOnlyField()
  paid_at?: string;

  @IsEnum(PaymentMethod, {
    message: `Le moyen de paiement doit être l'un de : ${Object.values(PaymentMethod).join(', ')}.`,
  })
  method: PaymentMethod;
}

export class AttachReceiptDto {
  /** Identifiant renvoyé par POST /files avec purpose=receipt. */
  @IsUUID('all', { message: 'file_id doit être un UUID valide.' })
  file_id: string;
}