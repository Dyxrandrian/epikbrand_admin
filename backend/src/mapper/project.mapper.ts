import type { Project } from '../entities/project.entity.js';
import { ProjectStatus } from '../enums/app.enums.js';
import type { ProjectTeamMember, TaskStats } from '../repository/project.repository.js';

export function progressOf(stats: TaskStats): number {
  return stats.total === 0 ? 0 : Math.round((stats.done * 100) / stats.total);
}

export interface ProjectViewOptions {
  /** Budget : admin et manager uniquement. */
  includeBudget: boolean;
  /** Date du jour (AAAA-MM-JJ) dans le fuseau de l'entreprise. */
  today: string;
  stats?: TaskStats;
}

export function toProject(project: Project, options: ProjectViewOptions) {
  return {
    id: project.id,
    client_id: project.clientId,
    title: project.title,
    description: project.description,
    status: project.status,
    deadline: project.deadline,
    is_overdue:
      project.deadline !== null &&
      project.deadline < options.today &&
      project.status !== ProjectStatus.DELIVERED,
    ...(options.includeBudget ? { budget_ht: project.budgetHt } : {}),
    ...(options.stats
      ? { progress: progressOf(options.stats), tasks_summary: options.stats }
      : {}),
    ...(project.client
      ? { client: { id: project.client.id, company_name: project.client.companyName } }
      : {}),
    archived_at: project.archivedAt,
    version: project.version, // à renvoyer lors d'une modification
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
}

export function toTeamMember(member: ProjectTeamMember) {
  return {
    id: member.id,
    name: member.name,
    avatar_url: member.avatarUrl,
    job_title: member.jobTitle,
    tasks_count: member.tasksCount,
  };
}