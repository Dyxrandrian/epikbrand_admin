import type { RefreshToken } from '../entities/refresh-token.entity.js';

export function toSession(token: RefreshToken) {
  return {
    session_id: token.familyId,
    user_agent: token.userAgent,
    ip_address: token.ipAddress,
    last_active_at: token.createdAt, // date du dernier rafraîchissement
    expires_at: token.expiresAt,
  };
}