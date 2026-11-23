export type JobResult = Record<string, unknown>;
export type TriggeredBy = 'schedule' | 'manual';

export interface CompanyJobContext {
  companyId: string;
  timeZone: string;
  /** Devise par défaut de l'entreprise (pour formater les montants des notifications). */
  currency: string;
  /** Date du jour (AAAA-MM-JJ) dans le fuseau de l'entreprise. */
  today: string;
  now: Date;
}

export interface GlobalJobContext {
  today: string;
  now: Date;
}

interface JobBase {
  readonly name: string;
  readonly description: string;
}

/** Tâche exécutée pour chaque entreprise, avec son fuseau et son identifiant explicites. */
export interface CompanyJob extends JobBase {
  readonly scope: 'company';
  run(ctx: CompanyJobContext): Promise<JobResult>;
}

/** Tâche de maintenance qui ne dépend d'aucune entreprise. */
export interface GlobalJob extends JobBase {
  readonly scope: 'global';
  run(ctx: GlobalJobContext): Promise<JobResult>;
}

export type ScheduledJob = CompanyJob | GlobalJob;