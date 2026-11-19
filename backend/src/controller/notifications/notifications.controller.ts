import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { uuidPipe } from '../../dto/index.js';
import {
  NotificationListQueryDto,
  UpdateNotificationPreferencesDto,
} from '../../dto/notifications/index.js';
import { CurrentUser, RateLimit } from '../../security/index.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../../security/index.js';
import { NotificationHub } from '../../services/notifications/notification-hub.js';
import { NotificationService } from '../../services/notifications/notification.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly hub: NotificationHub,
  ) {}

  @Get()
  list(@CurrentUser() viewer: AuthenticatedUser, @Query() query: NotificationListQueryDto) {
    return this.notifications.list(viewer, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() viewer: AuthenticatedUser) {
    return { unread_count: await this.notifications.unreadCount(viewer) };
  }

  /**
   * Flux SSE. Le client doit envoyer l'en-tête Authorization (EventSource natif impossible).
   * Événements : ready, notification, unread_count, token_expired, replaced, closed.
   * Rien n'est renvoyé par la méthode : la réponse reste ouverte, gérée par le hub.
   */
  @RateLimit({ limit: 20, windowSeconds: 60, scope: 'user' })
  @Get('stream')
  async stream(
    @CurrentUser() viewer: AuthenticatedUser,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    // Toutes les vérifications asynchrones AVANT l'ouverture : après, plus d'erreur HTTP possible
    const unread = await this.notifications.unreadCount(viewer);
    this.hub.open({
      userId: viewer.id,
      res,
      expiresAt: req.tokenExpiresAt,
      ready: { unread_count: unread },
    });
  }

  @Get('preferences')
  preferences(@CurrentUser() viewer: AuthenticatedUser) {
    return this.notifications.getPreferences(viewer);
  }

  @Patch('preferences')
  updatePreferences(
    @CurrentUser() viewer: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notifications.updatePreferences(viewer, dto);
  }

  @HttpCode(200)
  @Post('read-all')
  readAll(@CurrentUser() viewer: AuthenticatedUser) {
    return this.notifications.markAllRead(viewer);
  }

  @HttpCode(200)
  @Post(':id/read')
  markRead(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.notifications.markRead(viewer, id);
  }

  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentUser() viewer: AuthenticatedUser, @Param('id', uuidPipe('id')) id: string) {
    return this.notifications.remove(viewer, id);
  }
}