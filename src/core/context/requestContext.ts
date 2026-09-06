import { AsyncLocalStorage } from 'async_hooks';

interface RequestContextStore {
  requestId?: string;
  /** The acting admin's user id, when the current request is running under impersonation. */
  impersonatedBy?: string | null;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContextStore>();

export function getRequestContext(): RequestContextStore | undefined {
  return requestContextStorage.getStore();
}

/** Called by auth middleware once req.user is resolved, so later code (e.g. logAudit)
 * can attribute writes to the real acting admin without every call site passing it through. */
export function setImpersonatedBy(value: string | null): void {
  const store = requestContextStorage.getStore();
  if (store) store.impersonatedBy = value;
}
