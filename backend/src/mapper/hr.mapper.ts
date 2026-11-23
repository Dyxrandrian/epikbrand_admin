import type { LeaveRequest } from '../entities/leave-request.entity.js';
import type { TrainingRequest } from '../entities/training-request.entity.js';
import type { User } from '../entities/user.entity.js';

export type PersonFields = Pick<User, 'id' | 'name' | 'avatarUrl' | 'jobTitle'>;

export const toPerson = (user: PersonFields) => ({
  id: user.id,
  name: user.name,
  avatar_url: user.avatarUrl,
  job_title: user.jobTitle,
});

/** `user` et `leave_type` n'apparaissent que si la relation a été chargée. */
export function toLeaveRequest(request: LeaveRequest) {
  return {
    id: request.id,
    user_id: request.userId,
    leave_type_id: request.leaveTypeId,
    start_date: request.startDate,
    end_date: request.endDate,
    start_half_day: request.startHalfDay,
    end_half_day: request.endHalfDay,
    days_count: request.daysCount,
    reason: request.reason,
    status: request.status,
    reviewed_by: request.reviewedById,
    reviewed_at: request.reviewedAt,
    review_comment: request.reviewComment,
    ...(request.user ? { user: toPerson(request.user) } : {}),
    ...(request.leaveType
      ? { leave_type: { id: request.leaveType.id, name: request.leaveType.name } }
      : {}),
    created_at: request.createdAt,
  };
}

export function toTrainingRequest(request: TrainingRequest) {
  return {
    id: request.id,
    user_id: request.userId,
    training_name: request.trainingName,
    description: request.description,
    status: request.status,
    reviewed_by: request.reviewedById,
    reviewed_at: request.reviewedAt,
    review_comment: request.reviewComment,
    ...(request.user ? { user: toPerson(request.user) } : {}),
    created_at: request.createdAt,
  };
}

export interface BalanceLine {
  leaveTypeId: string;
  leaveTypeName: string;
  year: number;
  /** null : ce type n'a pas de quota annuel. */
  allowance: number | null;
  used: number;
  pending: number;
  remaining: number | null;
}

export const toBalanceLine = (line: BalanceLine) => ({
  leave_type: { id: line.leaveTypeId, name: line.leaveTypeName },
  year: line.year,
  has_quota: line.allowance !== null,
  allowance_days: line.allowance,
  used_days: line.used,
  pending_days: line.pending,
  remaining_days: line.remaining,
});