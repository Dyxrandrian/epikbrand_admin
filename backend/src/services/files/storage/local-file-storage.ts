import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import type { ConfigService } from '@nestjs/config';
import { FileStorage, StorageObjectNotFoundError, assertValidStorageKey } from './file-storage.js';
import type { PutMeta } from './file-storage.js';

/** Disque local : pour le développement. */
export class LocalFileStorage extends FileStorage {
  private readonly root: string;

  constructor(config: ConfigService) {
    super();
    this.root = resolve(config.get<string>('STORAGE_LOCAL_DIR') ?? './storage');
  }

  async put(key: string, sourcePath: string, _meta: PutMeta): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    // Écriture complète sous un nom provisoire, puis renommage : jamais de fichier à moitié écrit
    const partial = `${target}.${randomUUID()}.part`;
    await copyFile(sourcePath, partial);
    await rename(partial, target);
  }

  async getStream(key: string): Promise<Readable> {
    try {
      const handle = await open(this.pathFor(key), 'r');
      return handle.createReadStream();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StorageObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    assertValidStorageKey(key);
    return join(this.root, ...key.split('/'));
  }
}