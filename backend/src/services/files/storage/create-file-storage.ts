import type { ConfigService } from '@nestjs/config';
import type { FileStorage } from './file-storage.js';
import { LocalFileStorage } from './local-file-storage.js';
import { R2FileStorage } from './r2-file-storage.js';

export function createFileStorage(config: ConfigService): FileStorage {
  return config.get<string>('STORAGE_DRIVER') === 'r2'
    ? new R2FileStorage(config)
    : new LocalFileStorage(config);
}