import { readFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';
import { FileStorage, StorageObjectNotFoundError, assertValidStorageKey } from './file-storage.js';
import type { PutMeta } from './file-storage.js';

/** Cloudflare R2, via son API compatible S3. Le bucket reste privé : tout passe par l'API. */
export class R2FileStorage extends FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    super();
    const accountId = config.getOrThrow<string>('R2_ACCOUNT_ID');
    this.bucket = config.getOrThrow<string>('R2_BUCKET');
    this.client = new S3Client({
      region: 'auto',
      endpoint:
        config.get<string>('R2_ENDPOINT')?.trim() ||
        `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
      },
      // Les versions récentes du SDK ajoutent des sommes de contrôle que R2 n'accepte pas toujours
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async put(key: string, sourcePath: string, meta: PutMeta): Promise<void> {
    assertValidStorageKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: await readFile(sourcePath),
        ContentType: meta.contentType,
      }),
    );
  }

  async getStream(key: string): Promise<Readable> {
    assertValidStorageKey(key);
    try {
      const output = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!output.Body) throw new StorageObjectNotFoundError(key);
      return output.Body as Readable;
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') throw new StorageObjectNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertValidStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}