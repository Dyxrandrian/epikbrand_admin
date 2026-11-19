import type { Notification } from '../entities/notification.entity.js';

export function toNotification(notification: Notification) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    content: notification.content,
    is_read: notification.isRead ?? false,
    read_at: notification.readAt ?? null,
    redirect_url: notification.redirectUrl ?? null,
    created_at: notification.createdAt,
  };
}