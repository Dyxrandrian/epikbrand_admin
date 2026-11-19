import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { NotificationType } from '../../enums/notification.enums.js';

export class NotificationPreferenceItemDto {
  @IsEnum(NotificationType, {
    message: `type doit être l'un de : ${Object.values(NotificationType).join(', ')}.`,
  })
  type: NotificationType;

  /** Notification dans l'application. */
  @ValidateIf((o: NotificationPreferenceItemDto) => o.in_app !== undefined)
  @IsBoolean({ message: 'in_app doit valoir true ou false.' })
  in_app?: boolean;

  /** Notification par e-mail. */
  @ValidateIf((o: NotificationPreferenceItemDto) => o.email !== undefined)
  @IsBoolean({ message: 'email doit valoir true ou false.' })
  email?: boolean;
}

export class UpdateNotificationPreferencesDto {
  /** Seuls les types listés sont modifiés ; les autres gardent leur valeur. */
  @IsArray({ message: 'preferences doit être une liste.' })
  @ArrayMinSize(1, { message: 'preferences doit contenir au moins un élément.' })
  @ArrayMaxSize(Object.values(NotificationType).length, {
    message: 'preferences contient trop d\'éléments.',
  })
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceItemDto)
  preferences: NotificationPreferenceItemDto[];
}