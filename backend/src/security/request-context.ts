import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  ip: string | null;
  userAgent: string | null;
  userId?: string;
  companyId?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },
  /** Undefined hors requête (tâches planifiées, scripts). */
  get(): RequestContextStore | undefined {
    return storage.getStore();
  },
};