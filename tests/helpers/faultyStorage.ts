import { IDBFactory } from 'fake-indexeddb';
import { createIdbStorage } from '@/lib/store/storage';
import type { VaultStorage } from '@/lib/store/storage';
import { StorageError } from '@/lib/store/errors';

type Op = 'readCurrent' | 'readPrevious' | 'create' | 'commit' | 'replace' | 'swapPrevious' | 'discardPrevious' | 'deleteAll';
const WRITE_OPS: Op[] = ['create', 'commit', 'replace', 'swapPrevious', 'discardPrevious', 'deleteAll'];

export interface Gate {
  /** resolves once the gated call has started (and is paused) */
  reached: Promise<void>;
  /** let the gated call proceed to the real storage */
  release(): void;
}

/**
 * Wraps a real (fake-indexeddb) storage with fault injection:
 * - failNext(op): the next call to `op` throws a StorageError without writing
 * - landThenFail(op): the next call writes for real, then reports a timeout
 * - gate(op): pause the next call to `op` until released
 * - tracks max concurrent writes and every committed record
 */
export class FaultyStorage implements VaultStorage {
  readonly inner: VaultStorage;
  readonly factory: IDBFactory;
  readonly calls: Op[] = [];
  readonly committed: unknown[] = [];
  maxConcurrentWrites = 0;
  private inFlightWrites = 0;
  private failures = new Map<Op, number>();
  private landFailures = new Map<Op, number>();
  private gates = new Map<Op, { open: Promise<void>; reached: () => void }>();
  failAllWrites = false;

  constructor(factory: IDBFactory = new IDBFactory(), timeoutMs = 2_000) {
    this.factory = factory;
    this.inner = createIdbStorage({ factory, timeoutMs });
  }

  failNext(op: Op, times = 1): void {
    this.failures.set(op, (this.failures.get(op) ?? 0) + times);
  }

  landThenFail(op: Op): void {
    this.landFailures.set(op, (this.landFailures.get(op) ?? 0) + 1);
  }

  gate(op: Op): Gate {
    let release!: () => void;
    let reached!: () => void;
    const open = new Promise<void>((r) => (release = r));
    const reachedP = new Promise<void>((r) => (reached = r));
    this.gates.set(op, { open, reached });
    return { reached: reachedP, release };
  }

  private async call<T>(op: Op, fn: () => Promise<T>): Promise<T> {
    this.calls.push(op);
    const isWrite = WRITE_OPS.includes(op);
    if (isWrite) {
      this.inFlightWrites++;
      this.maxConcurrentWrites = Math.max(this.maxConcurrentWrites, this.inFlightWrites);
    }
    try {
      const g = this.gates.get(op);
      if (g) {
        this.gates.delete(op);
        g.reached();
        await g.open;
      }
      const n = this.failures.get(op) ?? 0;
      if ((isWrite && this.failAllWrites) || n > 0) {
        if (n > 0) this.failures.set(op, n - 1);
        throw new StorageError('quota', `injected ${op} failure`);
      }
      const result = await fn();
      const l = this.landFailures.get(op) ?? 0;
      if (l > 0) {
        this.landFailures.set(op, l - 1);
        throw new StorageError('timeout', `injected ${op} timeout after landing`);
      }
      return result;
    } finally {
      if (isWrite) this.inFlightWrites--;
    }
  }

  readCurrent() { return this.call('readCurrent', () => this.inner.readCurrent()); }
  readPrevious() { return this.call('readPrevious', () => this.inner.readPrevious()); }
  create(next: Parameters<VaultStorage['create']>[0]) {
    return this.call('create', async () => { await this.inner.create(next); this.committed.push(next); });
  }
  commit(next: Parameters<VaultStorage['commit']>[0], expected: unknown) {
    return this.call('commit', async () => { await this.inner.commit(next, expected); this.committed.push(next); });
  }
  replace(next: Parameters<VaultStorage['replace']>[0], expected: unknown) {
    return this.call('replace', async () => { await this.inner.replace(next, expected); this.committed.push(next); });
  }
  swapPrevious(expected: unknown) { return this.call('swapPrevious', () => this.inner.swapPrevious(expected)); }
  discardPrevious() { return this.call('discardPrevious', () => this.inner.discardPrevious()); }
  deleteAll() { return this.call('deleteAll', () => this.inner.deleteAll()); }
  onEvent(cb: Parameters<VaultStorage['onEvent']>[0]) { return this.inner.onEvent(cb); }
  close() { this.inner.close(); }
}

/** Write a raw record straight into a v2 database (e.g. to seed a legacy v1 vault). */
export async function seedRaw(factory: IDBFactory, record: unknown, key = 'current', version = 2): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open('keyhaven', version);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('vault')) req.result.createObjectStore('vault');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('vault', 'readwrite');
    tx.objectStore('vault').put(record, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
