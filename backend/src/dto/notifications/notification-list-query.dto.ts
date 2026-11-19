import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { NotificationType } from '../../enums/notification.enums.js';
import { PageQueryDto } from '../pagination-query.dto.js';
import { toBoolean } from '../transforms.js';

export class NotificationListQueryDto extends PageQueryDto {
  /** true : lues ; false : non lues. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'is_read doit valoir true ou false.' })
  is_read?: boolean;

  @IsOptional()
  @IsEnum(NotificationType, {
    message: `type doit être l'un de : ${Object.values(NotificationType).join(', ')}.`,
  })
  type?: NotificationType;
}