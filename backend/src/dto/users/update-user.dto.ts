import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { UserRole } from '../../enums/app.enums.js';
import { trimToNull } from '../transforms.js';

export class UpdateUserDto {
  @ValidateIf((o: UpdateUserDto) => o.role !== undefined)
  @IsEnum(UserRole, {
    message: `Le rôle doit être l'un de : ${Object.values(UserRole).join(', ')}.`,
  })
  role?: UserRole;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'Le poste doit être un texte.' })
  @MaxLength(100, { message: 'Le poste ne peut pas dépasser 100 caractères.' })
  job_title?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'Le matricule doit être un texte.' })
  @MaxLength(50, { message: 'Le matricule ne peut pas dépasser 50 caractères.' })
  matricule?: string | null;

  @ValidateIf((o: UpdateUserDto) => o.is_active !== undefined)
  @IsBoolean({ message: 'is_active doit valoir true ou false.' })
  is_active?: boolean;
}