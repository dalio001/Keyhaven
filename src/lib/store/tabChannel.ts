/**
 * Cross-tab coordination hints for the vault (no secrets ever cross it).
 *
 * BroadcastChannel delivery is best effort (frozen/bfcached tabs miss
 * messages), so messages are only hints. Correctness comes from the
 * compare-and-swap writes in storage.ts.
 */

export type TabMessage =
  /** a tab unlocked the vault at `at` (ms); older unlocked tabs lock themselves */
  | { t: 'unlocked'; tab: string; at: number }
  /** a tab committed a new record */
  | { t: 'committed'; tab: string; vaultId: string; commitId: string }
  /** the vault was replaced (import / restore) */
  | { t: 'replaced'; tab: string }
  /** the vault was deleted */
  | { t: 'deleted'; tab: string };

export interface TabChannel {
  post(msg: TabMessage): void;
  subscribe(cb: (msg: TabMessage) => void): () => void;
  close(): void;
}

export const TAB_CHANNEL_NAME = 'keyhaven-vault';

/** Real BroadcastChannel transport, or null where unsupported. */
export function createBroadcastTabChannel(name = TAB_CHANNEL_NAME): TabChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const bc = new BroadcastChannel(name);
  const listeners = new Set<(msg: TabMessage) => void>();
  bc.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as TabMessage | null;
    if (msg && typeof msg === 'object' && typeof msg.t === 'string' && typeof msg.tab === 'string') {
      listeners.forEach((l) => l(msg));
    }
  };
  return {
    post(msg) {
      try {
        bc.postMessage(msg);
      } catch {
        /* channel closed */
      }
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    close() {
      listeners.clear();
      bc.close();
    },
  };
}
