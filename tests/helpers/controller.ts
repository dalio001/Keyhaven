import { IDBFactory } from 'fake-indexeddb';
import { VaultController } from '@/lib/store/controller';
import type { TabChannel, TabMessage } from '@/lib/store/tabChannel';
import { deriveVaultKey, openText } from '@/lib/crypto';
import { parsePayload, parseStoredRecord } from '@/lib/store/format';
import type { VaultPayload } from '@/lib/store/format';
import type { VaultEntry } from '@/lib/vault';
import { FaultyStorage } from './faultyStorage';
import { TEST_ITERATIONS } from './fixtures';

export const PW = 'synthetic-test-Password-42';

export function makeController(
  o: { factory?: IDBFactory; storage?: FaultyStorage; channel?: TabChannel | null; tabId?: string } = {},
) {
  const storage = o.storage ?? new FaultyStorage(o.factory ?? new IDBFactory());
  const c = new VaultController({
    storage,
    channel: o.channel ?? null,
    kdfIterations: TEST_ITERATIONS,
    retryDelaysMs: [],
    tabId: o.tabId,
  });
  return { c, storage, factory: storage.factory };
}

export async function started(o: Parameters<typeof makeController>[0] = {}) {
  const x = makeController(o);
  await x.c.start();
  return x;
}

/** A fresh, unlocked vault (created with PW). */
export async function freshVault(o: Parameters<typeof makeController>[0] = {}) {
  const x = await started(o);
  const r = await x.c.createVault(PW);
  if (r !== 'ok') throw new Error(`createVault: ${r}`);
  return x;
}

export function entry(id: string, extra: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id,
    title: `Synthetic ${id}`,
    url: `https://${id}.example.test`,
    username: `user-${id}`,
    password: `synthetic-secret-${id}`,
    category: 'other',
    favorite: false,
    updatedAt: '2026-10-02T00:00:00.000Z',
    lastUsedAt: '2026-10-02T00:00:00.000Z',
    ...extra,
  };
}

export const addEntry = (c: VaultController, e: VaultEntry) =>
  c.mutate((p) => ({ ...p, entries: [e, ...p.entries] }));

/** Decrypt whatever is stored under `key` with a password (independent of any controller). */
export async function readStoredPayload(
  storage: FaultyStorage,
  password = PW,
  which: 'current' | 'previous' = 'current',
): Promise<VaultPayload> {
  const raw = which === 'current' ? await storage.inner.readCurrent() : await storage.inner.readPrevious();
  const rec = parseStoredRecord(raw);
  const dk = await deriveVaultKey(password, rec.salt, rec.kdf.iterations);
  if (dk.verifier !== rec.verifier) throw new Error('wrong password for stored record');
  return parsePayload(await openText(dk.key, rec.blob));
}

/** In-memory BroadcastChannel stand-in; `deliver=false` simulates lost messages. */
export function memoryHub() {
  const members = new Set<(m: TabMessage) => void>();
  const hub = {
    deliver: true,
    log: [] as TabMessage[],
    channel(): TabChannel {
      let mine: ((m: TabMessage) => void) | null = null;
      return {
        post(msg) {
          hub.log.push(msg);
          if (!hub.deliver) return;
          const targets = [...members].filter((m) => m !== mine);
          setTimeout(() => targets.forEach((t) => t(msg)), 0);
        },
        subscribe(cb) {
          mine = cb;
          members.add(cb);
          return () => members.delete(cb);
        },
        close() {
          if (mine) members.delete(mine);
        },
      };
    },
  };
  return hub;
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await tick(5);
  }
}
