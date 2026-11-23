import { ConflictAppException, ErrorCode } from '../../exceptions/index.js';

/** Versions conservées par article ; les plus anciennes sont supprimées. */
export const MAX_VERSIONS_KEPT = 100;

export const staleVersion = (): ConflictAppException =>
  new ConflictAppException(
    'Cet article a été modifié entre-temps. Rechargez-le puis réessayez.',
    ErrorCode.VERSION_CONFLICT,
  );