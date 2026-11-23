import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_RUN_AT = '06:00';
const DEFAULT_TIME_ZONE = 'Indian/Antananarivo';

function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function days(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

@Injectable()
export class JobsConfig {
  readonly enabled: boolean;
  readonly runAt: string;
  readonly globalTimeZone: string;
  /** 0 = désactivé */
  readonly trashRetentionDays: number;
  readonly notificationRetentionDays: number;
  readonly auditRetentionDays: number;

  constructor(config: ConfigService) {
    const logger = new Logger('JobsConfig');

    this.enabled = (config.get<string>('JOBS_ENABLED') ?? 'true').trim().toLowerCase() !== 'false';

    const runAt = config.get<string>('JOBS_RUN_AT')?.trim();
    this.runAt = runAt && /^([01]\d|2[0-3]):[0-5]\d$/.test(runAt) ? runAt : DEFAULT_RUN_AT;

    const zone = config.get<string>('JOBS_TIMEZONE')?.trim();
    if (zone && !validTimeZone(zone)) {
      logger.warn(`JOBS_TIMEZONE invalide (« ${zone} ») : ${DEFAULT_TIME_ZONE} conservé.`);
    }
    this.globalTimeZone = zone && validTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;

    this.trashRetentionDays = days(config.get<string>('TRASH_RETENTION_DAYS'), 30);
    this.notificationRetentionDays = days(config.get<string>('NOTIFICATION_RETENTION_DAYS'), 90);
    this.auditRetentionDays = days(config.get<string>('AUDIT_RETENTION_DAYS'), 0);
  }
}