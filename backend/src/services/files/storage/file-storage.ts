import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

export class StorageObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Objet de stockage introuvable : ${key}`);
    this.name = 'StorageObjectNotFoundError';
  }
}

export interface PutMeta {
  contentType: string;
  size: number;
}

/** Classe abstraite : sert aussi de jeton d'injection. */
export abstract class FileStorage {
  /** Enregistre le fichier local `sourcePath` sous la clé `key`. */
  abstract put(key: string, sourcePath: string, meta: PutMeta): Promise<void>;
  /** Flux de lecture ; lève StorageObjectNotFoundError si l'objet n'existe pas. */
  abstract getStream(key: string): Promise<Readable>;
  /** Idempotent : supprimer un objet absent n'est pas une erreur. */
  abstract delete(key: string): Promise<void>;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_PATTERN = new RegExp(`^${UUID}/${UUID}$`);

/** Une clé est toujours <entreprise>/<identifiant aléatoire> : aucun chemin ne peut s'y glisser. */
export function assertValidStorageKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new Error(`Clé de stockage invalide : ${key}`);
}

export const newStorageKey = (companyId: string): string => `${companyId}/${randomUUID()}`;