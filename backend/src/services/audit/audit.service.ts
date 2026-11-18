import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuditLogListQueryDto } from '../../dto/audit/audit-log-list-query.dto.js';
import type { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import { AuditLogRepository } from '../../repository/audit-log.repository.js';
import { RequestContext } from '../../security/request-context.js';
import type { AuditChanges } from './audit-changes.js';

export interface AuditEntry {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  changes?: AuditChanges | null;
  /** Par défaut : l'entreprise de l'utilisateur connecté. Obligatoire hors requête authentifiée. */
  companyId?: string;
  /** Par défaut : l'utilisateur connecté. `null` = acteur inconnu. */
  userId?: string | null;
  /** Par défaut : l'IP de la requête. */
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly logs: AuditLogRepository) {}

  /**
   * Écrit une ligne d'audit ; lève une erreur si l'écriture échoue.
   * Avec `manager`, elle est dans la transaction de l'action auditée : les deux réussissent
   * ou échouent ensemble.
   */
  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    const context = RequestContext.get();
    const companyId = entry.companyId ?? context?.companyId;
    if (!companyId) {
      throw new Error(
        "Audit impossible : entreprise inconnue. Passez companyId explicitement hors d'une requête authentifiée.",
      );
    }

    await this.logs.append(
      {
        companyId,
        userId: entry.userId !== undefined ? entry.userId : (context?.userId ?? null),
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        changes: entry.changes ?? null,
        ipAddress: entry.ip !== undefined ? entry.ip : (context?.ip ?? null),
      },
      manager,
    );
  }

  /** Pour les événements secondaires : journalise sans jamais faire échouer l'appelant. */
  async recordQuietly(entry: AuditEntry): Promise<void> {
    try {
      await this.record(entry);
    } catch (error) {
      this.logger.error(`Échec d'écriture du journal d'audit (${entry.action})`, error as Error);
    }
  }

  list(companyId: string, query: AuditLogListQueryDto) {
    return this.logs.list(companyId, query);
  }
}