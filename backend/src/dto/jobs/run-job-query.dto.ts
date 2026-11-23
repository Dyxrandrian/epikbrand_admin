import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { toBoolean } from '../transforms.js';

export class RunJobQueryDto {
  /** true : relance la tâche même si elle a déjà été exécutée aujourd'hui (les rappels seront renvoyés). */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'force doit valoir true ou false.' })
  force?: boolean;
}