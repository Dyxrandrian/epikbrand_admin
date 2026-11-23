import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { CompanyRepository } from '../repository/company.repository.js';
import { errorMessage } from './job-helpers.js';
import { JobRunner } from './job-runner.js';
import type { RunOutcome } from './job-runner.js';
import { JobRegistry } from './job-registry.js';
import { localClock } from './job-time.js';
import { JobsConfig } from './jobs-config.js';
import type { CompanyJobContext } from './job.types.js';

const TICK_MS = 60_000;
const STARTUP_DELAY_MS = 20_000;
const SKIPPED_RECHECK_MS = 20 * 60_000;
const FAILED_RETRY_MS = 16 * 60_000;
const MEMO_TTL_MS = 48 * 3_600_000;

interface Memo {
  /** Pas de nouvelle tentative avant cet instant (Infinity : terminé pour ce jour). */
  until: number;
  setAt: number;
}

/**
 * Vérifie chaque minute quelles tâches sont dues : « à partir de l'heure choisie, heure locale de
 * l'entreprise, et pas encore exécutées aujourd'hui ». Si le serveur était arrêté à l'heure dite,
 * la tâche s'exécute dès son redémarrage. La base arbitre entre instances (JobRunRepository.claim).
 */
@Injectable()
export class JobScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('JobScheduler');
  private interval?: NodeJS.Timeout;
  private startup?: NodeJS.Timeout;
  private ticking = false;
  /** Évite de réinterroger la base à chaque minute pour une tâche déjà réglée. */
  private readonly memo = new Map<string, Memo>();

  constructor(
    private readonly config: JobsConfig,
    private readonly registry: JobRegistry,
    private readonly runner: JobRunner,
    private readonly companies: CompanyRepository,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.enabled) {
      this.logger.warn('Tâches planifiées désactivées (JOBS_ENABLED=false).');
      return;
    }
    this.interval = setInterval(() => void this.tick(), TICK_MS);
    this.interval.unref();
    this.startup = setTimeout(() => void this.tick(), STARTUP_DELAY_MS);
    this.startup.unref();
    this.logger.log(
      `Tâches planifiées actives : chaque jour à partir de ${this.config.runAt}, heure locale de chaque entreprise.`,
    );
  }

  onModuleDestroy(): void {
    clearInterval(this.interval);
    clearTimeout(this.startup);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return; // le cycle précédent n'est pas terminé
    this.ticking = true;
    try {
      this.prune(Date.now());
      await this.runGlobalJobs();
      for (const company of await this.companies.listForJobs()) {
        await this.runCompanyJobs(company);
      }
    } catch (error) {
      this.logger.error('Cycle des tâches planifiées interrompu', error as Error);
    } finally {
      this.ticking = false;
    }
  }

  private async runGlobalJobs(): Promise<void> {
    const now = new Date();
    const clock = localClock(this.config.globalTimeZone, now);
    if (clock.time < this.config.runAt) return;

    for (const job of this.registry.global()) {
      const key = `${job.name}|global|${clock.date}`;
      if (!this.isDue(key, now.getTime())) continue;
      await this.attempt(key, now, () =>
        this.runner.execute({
          jobName: job.name,
          companyId: null,
          runKey: clock.date,
          triggeredBy: 'schedule',
          run: () => job.run({ today: clock.date, now }),
        }),
      );
    }
  }

  private async runCompanyJobs(company: {
    id: string;
    timezone: string;
    defaultCurrency: string;
  }): Promise<void> {
    const now = new Date();
    const clock = localClock(company.timezone, now);
    if (clock.time < this.config.runAt) return; // pas encore l'heure chez cette entreprise

    for (const job of this.registry.company()) {
      const key = `${job.name}|${company.id}|${clock.date}`;
      if (!this.isDue(key, now.getTime())) continue;

      const ctx: CompanyJobContext = {
        companyId: company.id,
        timeZone: company.timezone,
        currency: company.defaultCurrency,
        today: clock.date,
        now,
      };
      await this.attempt(key, now, () =>
        this.runner.execute({
          jobName: job.name,
          companyId: company.id,
          runKey: clock.date,
          triggeredBy: 'schedule',
          run: () => job.run(ctx),
        }),
      );
    }
  }

  private async attempt(key: string, now: Date, execute: () => Promise<RunOutcome>): Promise<void> {
    try {
      this.remember(key, await execute(), now.getTime());
    } catch (error) {
      // Base injoignable au moment de réserver l'exécution : on réessaiera
      this.logger.error(`Réservation impossible (${key}) : ${errorMessage(error)}`);
      this.memo.set(key, { until: now.getTime() + FAILED_RETRY_MS, setAt: now.getTime() });
    }
  }

  private isDue(key: string, now: number): boolean {
    const memo = this.memo.get(key);
    return !memo || memo.until <= now;
  }

  private remember(key: string, outcome: RunOutcome, now: number): void {
    const wait =
      outcome.status === 'succeeded'
        ? Number.POSITIVE_INFINITY
        : outcome.status === 'failed'
          ? FAILED_RETRY_MS
          : SKIPPED_RECHECK_MS;
    this.memo.set(key, { until: now + wait, setAt: now });
  }

  private prune(now: number): void {
    for (const [key, memo] of this.memo) {
      if (now - memo.setAt > MEMO_TTL_MS) this.memo.delete(key);
    }
  }
}