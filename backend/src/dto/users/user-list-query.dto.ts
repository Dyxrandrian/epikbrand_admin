import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '../../enums/app.enums.js';
import { PaginationQueryDto } from '../pagination-query.dto.js';
import { toBoolean } from '../transforms.js';

export class UserListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(UserRole, {
    message: `role doit être l'un de : ${Object.values(UserRole).join(', ')}.`,
  })
  role?: UserRole;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'is_active doit valoir true ou false.' })
  is_active?: boolean;
}