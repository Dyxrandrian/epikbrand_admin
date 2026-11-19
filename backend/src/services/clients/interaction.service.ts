import { Injectable } from '@nestjs/common';
import type {
  CreateInteractionDto,
  InteractionFiltersDto,
  InteractionListQueryDto,
  UpdateInteractionDto,
} from '../../dto/interactions/index.js';
import { mapDto } from '../../dto/map-dto.js';
import type { Client } from '../../entities/client.entity.js';
import type { Interaction } from '../../entities/interaction.entity.js';
import {
  AccessDeniedException,
  BusinessRuleException,
} from '../../exceptions/index.js';
import { toInteraction } from '../../mapper/crm.mapper.js';
import type { UpdateChanges } from '../../repository/index.js';
import { ClientRepository } from '../../repository/client.repository.js';
import { InteractionRepository } from '../../repository/interaction.repository.js';
import { isManagerOrAdmin } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';

/** Tolérance sur l'horloge entre le serveur et l'appareil de l'utilisateur. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

@Injectable()
export class InteractionService {
  constructor(
    private readonly interactions: InteractionRepository,
    private readonly clients: ClientRepository,
  ) {}

  async listForClient(viewer: AuthenticatedUser, clientId: string, query: InteractionFiltersDto) {
    const client = await this.loadReadableClient(viewer, clientId);
    const result = await this.interactions.list(viewer.companyId, query, { clientId: client.id });
    return result.map(toInteraction);
  }

  async list(viewer: AuthenticatedUser, query: InteractionListQueryDto) {
    const result = await this.interactions.list(viewer.companyId, query, {
      clientId: query.client_id,
      activeClientsOnly: !isManagerOrAdmin(viewer),
    });
    return result.map(toInteraction);
  }

  /** L'auteur est toujours l'utilisateur connecté, jamais une valeur envoyée par le client. */
  async create(viewer: AuthenticatedUser, clientId: string, dto: CreateInteractionDto) {
    // Client actif seulement : on n'ajoute rien à un client archivé (404)
    const client = await this.clients.getById(viewer.companyId, clientId);

    const created = await this.interactions.createOne(viewer.companyId, {
      clientId: client.id,
      userId: viewer.id,
      type: dto.type,
      summary: dto.summary,
      interactionDate: this.resolveDate(dto.interaction_date),
    });
    return toInteraction(await this.interactions.getDetailed(viewer.companyId, created.id));
  }

  async update(viewer: AuthenticatedUser, id: string, dto: UpdateInteractionDto) {
    const existing = await this.interactions.getById(viewer.companyId, id);
    this.assertCanModify(viewer, existing);

    const changes: Record<string, unknown> = mapDto(dto, { type: 'type', summary: 'summary' });
    if (dto.interaction_date !== undefined) {
      changes.interactionDate = this.resolveDate(dto.interaction_date);
    }

    if (Object.keys(changes).length > 0) {
      await this.interactions.updateById(
        viewer.companyId,
        id,
        changes as UpdateChanges<Interaction>,
      );
    }
    return toInteraction(await this.interactions.getDetailed(viewer.companyId, id));
  }

  async remove(viewer: AuthenticatedUser, id: string): Promise<void> {
    const existing = await this.interactions.getById(viewer.companyId, id);
    this.assertCanModify(viewer, existing);
    await this.interactions.deleteById(viewer.companyId, id);
  }

  /** Admin et manager voient aussi les clients archivés ; un collaborateur reçoit un 404. */
  private loadReadableClient(viewer: AuthenticatedUser, clientId: string): Promise<Client> {
    return isManagerOrAdmin(viewer)
      ? this.clients.getByIdIncludingArchived(viewer.companyId, clientId)
      : this.clients.getById(viewer.companyId, clientId);
  }

  /** Modification et suppression : l'auteur, un manager ou un admin. */
  private assertCanModify(viewer: AuthenticatedUser, interaction: Interaction): void {
    if (!isManagerOrAdmin(viewer) && interaction.userId !== viewer.id) {
      throw new AccessDeniedException(
        "Seuls l'auteur, un manager ou un administrateur peuvent modifier cette interaction.",
      );
    }
  }

  /** Maintenant par défaut ; antidatable, jamais dans le futur. */
  private resolveDate(raw: string | undefined): Date {
    if (!raw) return new Date();
    const date = new Date(raw);
    if (date.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      throw new BusinessRuleException("La date d'une interaction ne peut pas être dans le futur.");
    }
    return date;
  }
}