/**
 * Persistent storage (Phase 4). Browsers may clear a site's data when the
 * disk runs low; `navigator.storage.persist()` asks them to keep it. Chromium
 * decides silently, Firefox asks the user once, Safari applies its own rules.
 * It is not a backup. Nothing here ever throws.
 */

export type PersistState = 'persisted' | 'not-persisted' | 'unsupported';

export interface PersistManager {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

function manager(): PersistManager | null {
  try {
    const m = typeof navigator === 'undefined' ? undefined : navigator.storage;
    return m && typeof m.persisted === 'function' && typeof m.persist === 'function' ? m : null;
  } catch {
    return null;
  }
}

/** whether the browser keeps this site's storage — without asking */
export async function persistenceState(m: PersistManager | null = manager()): Promise<PersistState> {
  if (!m) return 'unsupported';
  try {
    return (await m.persisted()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}

/** ask the browser to keep this site's storage (only if it doesn't already) */
export async function requestPersistence(m: PersistManager | null = manager()): Promise<PersistState> {
  if (!m) return 'unsupported';
  try {
    if (await m.persisted()) return 'persisted';
    return (await m.persist()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}
