import { RequestStatus } from '../../enums/app.enums.js';
import {
  AccessDeniedException,
  ConflictAppException,
  ErrorCode,
} from '../../exceptions/index.js';

export interface ReviewableState {
  userId: string;
  status: RequestStatus;
}

/** Approuver ou rejeter : jamais sa propre demande, et seulement tant qu'elle est en attente. */
export function assertCanDecide(request: ReviewableState, actorId: string): void {
  if (request.userId === actorId) {
    throw new AccessDeniedException(
      'Vous ne pouvez pas valider votre propre demande.',
      ErrorCode.SELF_ACTION_FORBIDDEN,
    );
  }
  if (request.status !== RequestStatus.PENDING) {
    throw new ConflictAppException(
      'Cette demande a déjà été traitée : la décision ne peut plus être modifiée.',
      ErrorCode.INVALID_STATE,
    );
  }
}

export type CancelPlan = 'noop' | 'by_requester' | 'by_manager';

/**
 * Annulation : le demandeur tant que la demande est en attente ; un manager ou un admin pour une
 * demande approuvée. Une demande déjà annulée ne change pas (idempotent).
 */
export function planCancellation(
  request: ReviewableState,
  actor: { id: string; privileged: boolean },
): CancelPlan {
  switch (request.status) {
    case RequestStatus.CANCELLED:
      return 'noop';
    case RequestStatus.REJECTED:
      throw new ConflictAppException(
        'Cette demande a été rejetée : elle ne peut plus être annulée.',
        ErrorCode.INVALID_STATE,
      );
    case RequestStatus.PENDING:
      if (request.userId !== actor.id) {
        throw new AccessDeniedException(
          'Seul le demandeur peut annuler une demande en attente : rejetez-la à la place.',
        );
      }
      return 'by_requester';
    default:
      if (!actor.privileged) {
        throw new AccessDeniedException(
          'Cette demande a déjà été approuvée : seul un manager ou un administrateur peut l\'annuler.',
        );
      }
      return 'by_manager';
  }
}