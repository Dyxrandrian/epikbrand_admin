import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { toBoolean } from './transforms.js';

export class ConfirmQueryDto {
  /** true : confirme une action qui a demandé confirmation (409 CONFIRMATION_REQUIRED). */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'confirm doit valoir true ou false.' })
  confirm?: boolean;
}