import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { toBoolean } from '../transforms.js';

export class ForceQueryDto {
  /** true : créer le client même si un client similaire existe. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'force doit valoir true ou false.' })
  force?: boolean;
}