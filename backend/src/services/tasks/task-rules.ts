import { TaskStatus } from '../../enums/app.enums.js';
import { BusinessRuleException } from '../../exceptions/index.js';
import type { TaskViewer } from '../../repository/task.repository.js';
import { isManagerOrAdmin } from '../../security/index.js';
import type { AuthenticatedUser } from '../../security/index.js';

export const viewerOf = (user: AuthenticatedUser): TaskViewer => ({
  id: user.id,
  privileged: isManagerOrAdmin(user),
});

/** Passer à « done » enregistre completed_at ; quitter « done » l'efface. */
export function completionChange(
  previous: TaskStatus,
  next: TaskStatus,
): { completedAt?: Date | null } {
  if (previous === next) return {};
  if (next === TaskStatus.DONE) return { completedAt: new Date() };
  if (previous === TaskStatus.DONE) return { completedAt: null };
  return {};
}

export function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}

export function assertDateOrder(start: Date | null, end: Date | null): void {
  if (start && end && end.getTime() < start.getTime()) {
    throw new BusinessRuleException('La date de fin ne peut pas précéder la date de début.');
  }
}

export const unique = <T>(values: readonly T[] | undefined): T[] => [...new Set(values ?? [])];