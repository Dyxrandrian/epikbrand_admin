import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsController } from '../controller/notifications/notifications.controller.js';
import { Notification } from '../entities/notification.entity.js';
import { UserPreferences } from '../entities/user-preferences.entity.js';
import {
  NotificationPreferencesRepository,
  NotificationRepository,
} from '../repository/notification.repository.js';
import { NotificationHub } from '../services/notifications/notification-hub.js';
import { NotificationService } from '../services/notifications/notification.service.js';
import { MailModule } from './mail.module.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Notification, UserPreferences]), MailModule],
  controllers: [NotificationsController],
  providers: [
    NotificationRepository,
    NotificationPreferencesRepository,
    NotificationHub,
    NotificationService,
  ],
  exports: [NotificationService, NotificationHub],
})
export class NotificationsModule {}