import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  BusinessRuleException,
  ErrorCode,
  ServiceUnavailableAppException,
} from '../../../exceptions/index.js';

/** Lève une exception si le fichier est refusé ou si l'analyse est impossible. */
export abstract class VirusScanner {
  abstract scan(filePath: string): Promise<void>;
}

export class NoopVirusScanner extends VirusScanner {
  scan(): Promise<void> {
    return Promise.resolve();
  }
}

const CHUNK_BYTES = 64 * 1024;
const TIMEOUT_MS = 60_000;

/** Client ClamAV minimal (commande INSTREAM de clamd), sans dépendance. */
export class ClamAvScanner extends VirusScanner {
  private readonly logger = new Logger(ClamAvScanner.name);

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {
    super();
  }

  async scan(filePath: string): Promise<void> {
    const reply = await this.exchange(filePath).catch((error: unknown) => {
      this.logger.error('Analyse antivirus impossible', error as Error);
      throw this.unavailable();
    });

    if (/\bOK$/.test(reply)) return;
    if (reply.includes('FOUND')) {
      throw new BusinessRuleException(
        "Le fichier a été refusé par l'analyse antivirus.",
        ErrorCode.FILE_INFECTED,
      );
    }
    this.logger.error(`Réponse inattendue de ClamAV : « ${reply} »`);
    throw this.unavailable();
  }

  private unavailable(): ServiceUnavailableAppException {
    return new ServiceUnavailableAppException(
      "L'analyse antivirus est momentanément indisponible. Réessayez plus tard.",
      ErrorCode.SCAN_UNAVAILABLE,
    );
  }

  private exchange(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      let reply = '';
      let settled = false;

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(reply.replace(/\0/g, '').trim());
      };

      socket.setTimeout(TIMEOUT_MS, () => finish(new Error('Délai dépassé')));
      socket.on('error', finish);
      socket.on('data', (chunk: Buffer) => {
        reply += chunk.toString('utf8');
      });
      socket.on('end', () => finish()); // clamd ferme la connexion après sa réponse
      socket.on('connect', () => {
        void this.stream(socket, filePath).catch(finish);
      });
    });
  }

  private async stream(socket: Socket, filePath: string): Promise<void> {
    socket.write('zINSTREAM\0');
    for await (const chunk of createReadStream(filePath, { highWaterMark: CHUNK_BYTES })) {
      const data = chunk as Buffer;
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length, 0);
      if (!socket.write(Buffer.concat([length, data]))) await once(socket, 'drain');
    }
    socket.write(Buffer.alloc(4)); // fin du flux
  }
}

export function createVirusScanner(config: ConfigService): VirusScanner {
  const host = config.get<string>('CLAMAV_HOST')?.trim();
  if (!host) {
    if (config.get<string>('NODE_ENV') === 'production') {
      new Logger('VirusScanner').warn(
        "CLAMAV_HOST n'est pas défini : les fichiers envoyés ne sont PAS analysés.",
      );
    }
    return new NoopVirusScanner();
  }
  return new ClamAvScanner(host, Number(config.get('CLAMAV_PORT') ?? 3310));
}