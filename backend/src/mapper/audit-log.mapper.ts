import type { AuditLog } from '../entities/audit-log.entity.js';

export function toAuditLog(log: AuditLog) {
  return {
    id: log.id,
    user_id: log.userId,
    action: log.action,
    entity_type: log.entityType,
    entity_id: log.entityId,
    changes: log.changes,
    ip_address: log.ipAddress,
    created_at: log.createdAt,
  };
}