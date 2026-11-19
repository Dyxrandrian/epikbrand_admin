import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';

const HEARTBEAT_MS = 25_000; // signal de vie : empêche les proxys de couper la connexion
const MAX_CONNECTIONS_PER_USER = 5;
const MAX_BUFFERED_BYTES = 64 * 1024; // client trop lent : on coupe
const MAX_TIMER_MS = 2_147_483_647;
const DEFAULT_LIFETIME_MS = 10 * 60_000;
const RECONNECT_DELAY_MS = 5_000;

interface Connection {
  userId: string;
  res: Response;
  closed: boolean;
  timers: NodeJS.Timeout[];
}

export interface OpenStreamOptions {
  userId: string;
  res: Response;
  /** Expiration du jeton d'accès (ms depuis 1970) : le flux se ferme à ce moment. */
  expiresAt?: number;
  /** Données de l'événement `ready` envoyé à l'ouverture. */
  ready: Record<string, unknown>;
}

function frame(event: string, data: unknown, id?: string): string {
  return `event: ${event}\n${id ? `id: ${id}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
}

@Injectable()
export class NotificationHub implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationHub.name);
  private readonly connections = new Map<string, Set<Connection>>();

  /**
   * Ouvre le flux. À appeler une fois les vérifications asynchrones faites : après cet appel,
   * les en-têtes sont partis et plus aucune erreur HTTP ne peut être renvoyée.
   */
  open(options: OpenStreamOptions): void {
    const { userId, res } = options;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx : pas de mise en tampon
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    const connection: Connection = { userId, res, closed: false, timers: [] };

    const set = this.connections.get(userId) ?? new Set<Connection>();
    this.connections.set(userId, set);
    if (set.size >= MAX_CONNECTIONS_PER_USER) {
      const oldest = set.values().next().value;
      if (oldest) this.close(oldest, frame('replaced', { reason: 'too_many_connections' }));
    }
    set.add(connection);

    const lifetime = Math.min(
      MAX_TIMER_MS,
      options.expiresAt ? Math.max(0, options.expiresAt - Date.now()) : DEFAULT_LIFETIME_MS,
    );
    const heartbeat = setInterval(() => this.write(connection, ': ping\n\n'), HEARTBEAT_MS);
    const expiry = setTimeout(
      () => this.close(connection, frame('token_expired', { reconnect: true })),
      lifetime,
    );
    heartbeat.unref();
    expiry.unref();
    connection.timers.push(heartbeat, expiry);

    res.on('close', () => this.close(connection));

    this.write(connection, `retry: ${RECONNECT_DELAY_MS}\n\n`);
    this.write(connection, frame('ready', options.ready));
  }

  /** Envoie un événement à toutes les connexions ouvertes de l'utilisateur. */
  send(userId: string, event: string, data: unknown, id?: string): void {
    const set = this.connections.get(userId);
    if (!set) return;
    const message = frame(event, data, id);
    for (const connection of [...set]) this.write(connection, message);
  }

  closeUser(userId: string): void {
    for (const connection of [...(this.connections.get(userId) ?? [])]) {
      this.close(connection, frame('closed', { reason: 'closed_by_server' }));
    }
  }

  /** Arrêt de l'application : on ferme les flux pour ne pas bloquer la fermeture du serveur. */
  onModuleDestroy(): void {
    for (const set of [...this.connections.values()]) {
      for (const connection of [...set]) this.close(connection);
    }
  }

  private write(connection: Connection, chunk: string): void {
    if (connection.closed) return;
    try {
      if (connection.res.writableLength > MAX_BUFFERED_BYTES) {
        this.logger.warn('Flux SSE fermé : le client ne suit pas.');
        this.close(connection);
        return;
      }
      connection.res.write(chunk);
    } catch {
      this.close(connection);
    }
  }

  private close(connection: Connection, farewell?: string): void {
    if (connection.closed) return;
    connection.closed = true;

    // clearTimeout arrête aussi bien un setTimeout qu'un setInterval
    for (const timer of connection.timers) clearTimeout(timer);

    const set = this.connections.get(connection.userId);
    if (set) {
      set.delete(connection);
      if (set.size === 0) this.connections.delete(connection.userId);
    }

    try {
      if (farewell) connection.res.write(farewell);
      connection.res.end();
    } catch {
      // connexion déjà fermée côté client
    }
  }
}