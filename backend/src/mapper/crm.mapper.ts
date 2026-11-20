import type { Client } from '../entities/client.entity.js';
import type { Interaction } from '../entities/interaction.entity.js';
import type { Project } from '../entities/project.entity.js';

export function toClient(client: Client) {
  return {
    id: client.id,
    company_name: client.companyName,
    contact_name: client.contactName,
    email: client.email,
    phone: client.phone,
    address: client.address,
    nif: client.nif, 
    stat: client.stat,
    archived_at: client.archivedAt,
    version: client.version, // à renvoyer lors d'une modification
    created_at: client.createdAt,
    updated_at: client.updatedAt,
  };
}

export function toDuplicate(client: Client) {
  return {
    id: client.id,
    company_name: client.companyName,
    email: client.email,
    archived: client.archivedAt !== null,
  };
}

/** Le budget n'est montré qu'aux admins et managers. */
export function toClientProject(project: Project, includeBudget: boolean) {
  return {
    id: project.id,
    title: project.title,
    status: project.status,
    deadline: project.deadline,
    ...(includeBudget ? { budget_ht: project.budgetHt } : {}),
  };
}

/** `author` et `client` n'apparaissent que si la relation a été chargée. */
export function toInteraction(item: Interaction) {
  return {
    id: item.id,
    client_id: item.clientId,
    user_id: item.userId, // null si l'auteur a été supprimé
    type: item.type,
    summary: item.summary,
    interaction_date: item.interactionDate,
    ...(item.user !== undefined
      ? {
          author: item.user
            ? { id: item.user.id, name: item.user.name, avatar_url: item.user.avatarUrl }
            : null,
        }
      : {}),
    ...(item.client
      ? { client: { id: item.client.id, company_name: item.client.companyName } }
      : {}),
  };
}