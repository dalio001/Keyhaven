import { useCallback, useEffect, useState } from 'react';
import { persistenceState, requestPersistence } from '@/lib/persistence';
import type { PersistState } from '@/lib/persistence';

/** whether the browser keeps the vault's storage, and a way to ask (from a click) */
export function usePersistentStorage(): { state: PersistState | 'checking'; ask: () => Promise<void> } {
  const [state, setState] = useState<PersistState | 'checking'>('checking');
  useEffect(() => {
    let live = true;
    void persistenceState().then((s) => {
      if (live) setState(s);
    });
    return () => {
      live = false;
    };
  }, []);
  const ask = useCallback(async () => setState(await requestPersistence()), []);
  return { state, ask };
}
