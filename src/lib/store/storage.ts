/**
 * IndexedDB persistence for the encrypted vault record.
 *
 * - Database `keyhaven`, object store `vault`, keys `current` and `previous`.
 * - DB_VERSION 2 (was 1). The upgrade itself changes nothing; bumping it
 *   FENCES OFF tabs still running pre-Phase-1 code, whose blind writes could
 *   otherwise put a legacy record (with its insecure passkey wraps) back over
 *   a migrated one. Old code now fails to open the database instead.
 * - Every write is a compare-and-swap inside ONE readwrite transaction that
 *   uses request callbacks only (an `await` inside would auto-commit it).
 *   Writes resolve on `complete` with `durability: 'strict'`, so a record is
 *   either fully the old one or fully the new one.
 * - Records are stored as given; this layer never edits them (except to strip
 *   legacy passkey wraps from a record moved into the `previous` slot).
 */

import { ConflictError, ExistsError, StorageError } from './errors';
import type { VaultRecordV2 } from './format';

export const DB_NAME = 'keyhaven';
export const DB_VERSION = 2;
export const STORE = 'vault';
const CURRENT = 'current';
const PREVIOUS = 'previous';

export type StorageEventName = 'blocked' | 'superseded' | 'closed';

export interface VaultStorage {
  /** raw stored record (unvalidated), or undefined when absent */
  readCurrent(): Promise<unknown>;
  readPrevious(): Promise<unknown>;
  /** write `next` only if no vault exists (creation never overwrites) — ExistsError */
  create(next: VaultRecordV2): Promise<void>;
  /** compare-and-swap: write `next` only if the stored record is still `expected` — ConflictError */
  commit(next: VaultRecordV2, expected: unknown): Promise<void>;
  /** compare-and-swap; atomically moves the current record to `previous`, then writes `next` */
  replace(next: VaultRecordV2, expected: unknown): Promise<void>;
  /** compare-and-swap on current; atomically swaps `current` and `previous` */
  swapPrevious(expected: unknown): Promise<void>;
  discardPrevious(): Promise<void>;
  /** delete everything KeyHaven stored (current + previous) */
  deleteAll(): Promise<void>;
  onEvent(cb: (e: StorageEventName) => void): () => void;
  close(): void;
}

/**
 * Same record? v2 records compare by `vaultId` + `commitId` (a fresh random
 * token per write, so restoring an older copy cannot be mistaken for the
 * newer one). Anything else (legacy v1) must match exactly as stored.
 */
export function sameRecord(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  const ra = a as { version?: unknown; vaultId?: unknown; commitId?: unknown };
  const rb = b as { version?: unknown; vaultId?: unknown; commitId?: unknown };
  if (ra.version === 2 && rb.version === 2) {
    return ra.vaultId === rb.vaultId && ra.commitId === rb.commitId;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Copy of a record safe to keep in the `previous` slot (no legacy passkey wraps). */
function sanitizeForPrevious(rec: unknown): unknown {
  if (rec && typeof rec === 'object' && (rec as { version?: unknown }).version === 1 && 'passkeys' in rec) {
    const copy = { ...(rec as Record<string, unknown>) };
    delete copy.passkeys;
    return copy;
  }
  return rec;
}

function mapDomError(err: unknown, fallback: string): StorageError {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') {
    return new StorageError('quota', 'Browser storage is full — free up space and retry.', err);
  }
  if (name === 'VersionError') {
    return new StorageError('version', 'This browser storage was upgraded by a newer KeyHaven version.', err);
  }
  return new StorageError('io', fallback, err);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new StorageError('timeout', `Browser storage did not respond (${what}).`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

interface TxControl {
  /** abort the transaction with this error */
  fail(err: Error): void;
}

export interface IdbStorageOptions {
  factory?: IDBFactory;
  dbName?: string;
  dbVersion?: number;
  timeoutMs?: number;
}

export function createIdbStorage(opts: IdbStorageOptions = {}): VaultStorage {
  const dbName = opts.dbName ?? DB_NAME;
  const dbVersion = opts.dbVersion ?? DB_VERSION;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const listeners = new Set<(e: StorageEventName) => void>();
  let dbPromise: Promise<IDBDatabase> | null = null;
  let closed = false;

  const emit = (e: StorageEventName) => listeners.forEach((l) => l(e));

  function factory(): IDBFactory {
    const f = opts.factory ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
    if (!f) throw new StorageError('unavailable', 'This browser does not provide IndexedDB storage.');
    return f;
  }

  function getDb(): Promise<IDBDatabase> {
    if (closed) return Promise.reject(new StorageError('unavailable', 'Storage is closed.'));
    if (dbPromise) return dbPromise;
    const p = new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        req = factory().open(dbName, dbVersion);
      } catch (err) {
        reject(err instanceof StorageError ? err : mapDomError(err, 'Could not open browser storage.'));
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        // v1 → v2: same store and keys; the version bump only fences old code.
      };
      req.onblocked = () => emit('blocked');
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          if (dbPromise === p) dbPromise = null;
          emit('superseded');
        };
        db.onclose = () => {
          if (dbPromise === p) dbPromise = null;
          emit('closed');
        };
        if (closed) {
          db.close();
          reject(new StorageError('unavailable', 'Storage is closed.'));
          return;
        }
        resolve(db);
      };
      req.onerror = () => {
        if (dbPromise === p) dbPromise = null;
        reject(mapDomError(req.error, 'Could not open browser storage.'));
      };
    });
    dbPromise = p;
    return p;
  }

  async function run<T>(
    mode: IDBTransactionMode,
    what: string,
    body: (store: IDBObjectStore, ctl: TxControl, setResult: (v: T) => void) => void,
  ): Promise<T> {
    const db = await withTimeout(getDb(), timeoutMs, 'open');
    const op = new Promise<T>((resolve, reject) => {
      let failure: Error | null = null;
      let result: T | undefined;
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, mode, { durability: 'strict' });
      } catch (err) {
        reject(mapDomError(err, `Browser storage refused the ${what}.`));
        return;
      }
      const ctl: TxControl = {
        fail(err) {
          failure = err;
          try {
            tx.abort();
          } catch {
            /* already finished */
          }
        },
      };
      tx.oncomplete = () => (failure ? reject(failure) : resolve(result as T));
      tx.onabort = () => reject(failure ?? mapDomError(tx.error, `Browser storage aborted the ${what}.`));
      try {
        body(tx.objectStore(STORE), ctl, (v) => {
          result = v;
        });
      } catch (err) {
        ctl.fail(err instanceof Error ? err : mapDomError(err, `The ${what} failed.`));
      }
    });
    return withTimeout(op, timeoutMs, what);
  }

  function readKey(key: string): Promise<unknown> {
    return run<unknown>('readonly', 'read', (store, _ctl, set) => {
      const req = store.get(key);
      req.onsuccess = () => set(req.result);
    });
  }

  /** Compare-and-swap scaffold: read current, check, then let `write` queue puts. */
  function cas(
    what: string,
    expected: unknown,
    write: (store: IDBObjectStore, current: unknown, ctl: TxControl) => void,
  ): Promise<void> {
    return run<void>('readwrite', what, (store, ctl) => {
      const req = store.get(CURRENT);
      req.onsuccess = () => {
        const current = req.result;
        if (!sameRecord(current, expected)) {
          ctl.fail(new ConflictError());
          return;
        }
        write(store, current, ctl);
      };
    });
  }

  return {
    readCurrent: () => readKey(CURRENT),
    readPrevious: () => readKey(PREVIOUS),

    create(next) {
      return run<void>('readwrite', 'create', (store, ctl) => {
        const req = store.get(CURRENT);
        req.onsuccess = () => {
          if (req.result !== undefined) {
            ctl.fail(new ExistsError());
            return;
          }
          store.put(next, CURRENT);
        };
      });
    },

    commit(next, expected) {
      return cas('save', expected, (store) => {
        store.put(next, CURRENT);
      });
    },

    replace(next, expected) {
      return cas('replace', expected, (store, current) => {
        if (current !== undefined) store.put(sanitizeForPrevious(current), PREVIOUS);
        store.put(next, CURRENT);
      });
    },

    swapPrevious(expected) {
      return cas('restore', expected, (store, current, ctl) => {
        const req = store.get(PREVIOUS);
        req.onsuccess = () => {
          const prev = req.result;
          if (prev === undefined) {
            ctl.fail(new ConflictError('There is no previous vault to restore.'));
            return;
          }
          store.put(prev, CURRENT);
          if (current === undefined) store.delete(PREVIOUS);
          else store.put(sanitizeForPrevious(current), PREVIOUS);
        };
      });
    },

    discardPrevious() {
      return run<void>('readwrite', 'delete', (store) => {
        store.delete(PREVIOUS);
      });
    },

    deleteAll() {
      return run<void>('readwrite', 'delete', (store) => {
        store.clear();
      });
    },

    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    close() {
      closed = true;
      const p = dbPromise;
      dbPromise = null;
      void p?.then((db) => db.close()).catch(() => undefined);
    },
  };
}
