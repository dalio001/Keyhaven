/**
 * VaultController — the single owner of vault state, keys and persistence.
 *
 * DOM-free and React-free (the provider subscribes via useSyncExternalStore),
 * so every lifecycle rule below is unit-tested in Node.
 *
 * Save lifecycle
 * --------------
 * - `mutate()` applies a change in memory synchronously and bumps `seq`.
 * - One writer (`pump`) at a time, under a mutex, seals (encrypts) the newest
 *   in-memory state and commits it with compare-and-swap. Latest state wins;
 *   writes never overlap; a write built on a stale base is rejected, never
 *   applied. Sealed ciphertext must carry the committed record's verifier,
 *   so a write can never mix keys (e.g. during a password change).
 * - `flush()` resolves once everything mutated before the call is committed,
 *   and rejects (SaveError) if that write fails.
 * - `lock()` seals pending changes while the key is still present, THEN drops
 *   key + plaintext. The ciphertext write continues after locking. If storage
 *   fails, the encrypted pending record is kept in memory (never plaintext):
 *   it is retried, can be downloaded as an encrypted backup, or discarded.
 * - Import / restore / delete / password change run under the same mutex
 *   after pending writes, and bump `epoch` so in-flight work from the old
 *   vault can never write over the new state.
 */

import { generateBackupCodes } from '../crypto';
import { verifyTotp } from '../totp';
import { DEFAULT_SETTINGS } from '../vault';
import type { VaultEntry } from '../vault';
import { consumeBackupCode, findBackupCode } from './backupCodes';
import {
  createRecord,
  deriveForRecord,
  isCorruption,
  migrateV1,
  openPayload,
  openTotpSecret,
  rekey,
  sealFields,
} from './codec';
import type { KeyMaterial, SealedFields } from './codec';
import { ConflictError, ExistsError, SaveError, StorageError } from './errors';
import {
  FormatError,
  legacyPasskeyCount,
  parseBackupFile,
  parseStoredRecord,
  serializeBackupFile,
} from './format';
import type { AnyVaultRecord, MigratedFrom, VaultPayload, VaultRecordV2 } from './format';
import { Mutex } from './mutex';
import { sameRecord } from './storage';
import type { VaultStorage } from './storage';
import type { TabChannel, TabMessage } from './tabChannel';
import { KDF_ITERATIONS } from '../crypto';

/* ------------------------------------------------------------------ */
/* public types                                                        */
/* ------------------------------------------------------------------ */

export type VaultStatus = 'loading' | 'unavailable' | 'no-vault' | 'locked' | 'unlocked';
export type UnavailableReason = 'storage' | 'blocked' | 'superseded' | 'unsupported-version' | 'invalid-record';
export type SaveState = 'saved' | 'saving' | 'error' | 'conflict';
export type LockReason = null | 'other-tab' | 'replaced' | 'deleted' | 'stale' | 'conflict';
export type BusyState = null | 'unlocking' | 'migrating' | 'importing' | 'rekeying';
export type SecondFactor = { totp: string } | { backupCode: string };

export type UnlockResult =
  | 'ok'
  | 'bad-password'
  | 'totp-required'
  | 'totp-invalid'
  | 'backup-code-invalid'
  | 'corrupt'
  | 'unsupported-version'
  | 'no-vault'
  | 'migration-failed'
  | 'storage-error'
  | 'unsaved-pending'
  | 'superseded';

export type ImportFailure =
  | 'invalid-file'
  | 'unsupported-version'
  | 'bad-password'
  | 'corrupt'
  | 'current-unsaved'
  | 'conflict'
  | 'storage-error'
  | 'not-allowed';
export type ImportResult =
  | { ok: true; unlocked: boolean; migrated: boolean }
  | { ok: false; reason: ImportFailure; detail?: string };

export type ChangePasswordResult = 'ok' | 'bad-password' | 'conflict' | 'storage-error' | 'locked';
export type FactorResult = 'ok' | 'invalid-code' | 'factor-required' | 'save-failed' | 'locked';
export type ExportResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'storage' | 'conflict' | 'locked'; unsavedText: string | null };

export interface VaultSnapshot {
  status: VaultStatus;
  unavailableReason: UnavailableReason | null;
  unavailableDetail: string | null;
  hasVault: boolean;
  totpEnabled: boolean;
  /** legacy (insecure) passkey wraps still present in a not-yet-migrated stored record */
  legacyPasskeys: number;
  /** true while the stored record is a legacy v1 record (migrates on next password unlock) */
  needsMigration: boolean;
  /** decrypted payload — only while unlocked */
  data: VaultPayload | null;
  vaultId: string | null;
  migratedFrom: MigratedFrom | null;
  save: {
    state: SaveState;
    lastSavedAt: string | null;
    /** in-memory changes not yet committed to storage (encrypted once locked) */
    unsaved: boolean;
  };
  lockReason: LockReason;
  busy: BusyState;
  previous: { updatedAt: string | null } | null;
  /** one-off notices for the UI */
  notice: null | 'totp-reset';
}

export interface ControllerOptions {
  storage: VaultStorage;
  channel?: TabChannel | null;
  /** PBKDF2 iterations for NEW keys (create, migration, password change). Unlock always uses the record's own. */
  kdfIterations?: number;
  now?: () => Date;
  uuid?: () => string;
  /** automatic retry backoff after a failed save (ms); [] disables automatic retries */
  retryDelaysMs?: number[];
  tabId?: string;
}

/* ------------------------------------------------------------------ */
/* internals                                                           */
/* ------------------------------------------------------------------ */

type Phase = 'loading' | 'unavailable' | 'no-vault' | 'locked' | 'unlocked' | 'locking';

interface Desired {
  payload: VaultPayload;
  totpSecret: string | null;
}

interface Waiter {
  target: number;
  resolve: () => void;
  reject: (e: SaveError) => void;
}

const noop = () => undefined;

function isV2(rec: AnyVaultRecord | null): rec is VaultRecordV2 {
  return !!rec && rec.version === 2;
}

export class VaultController {
  private readonly storage: VaultStorage;
  private readonly channel: TabChannel | null;
  private readonly iterations: number;
  private readonly now: () => Date;
  private readonly uuid: () => string;
  private readonly retryDelays: number[];
  readonly tabId: string;

  private readonly mutex = new Mutex();
  private readonly listeners = new Set<() => void>();
  private snapshot: VaultSnapshot;

  private phase: Phase = 'loading';
  private unavailableReason: UnavailableReason | null = null;
  private unavailableDetail: string | null = null;
  private epoch = 0;
  private km: KeyMaterial | null = null;
  private desired: Desired | null = null;
  private seq = 0;
  private committedSeq = 0;
  /** last record known to be in storage (any version) */
  private stored: AnyVaultRecord | null = null;
  /** compare-and-swap base for writes (the stored v2 record this session is built on) */
  private committed: VaultRecordV2 | null = null;
  private sealed: { seq: number; fields: SealedFields } | null = null;
  private readonly attempted = new Map<string, number>();
  private waiters: Waiter[] = [];
  private saveState: SaveState = 'saved';
  private lastSavedAt: string | null = null;
  private lockReason: LockReason = null;
  private busy: BusyState = null;
  private notice: VaultSnapshot['notice'] = null;
  private previous: { updatedAt: string | null } | null = null;
  private lockPromise: Promise<void> | null = null;
  private keyTransition: Promise<void> | null = null;
  private pumpPromise: Promise<void> | null = null;
  private pumpAgain = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private unlockStamp: number | null = null;
  private started = false;
  private disposed = false;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(o: ControllerOptions) {
    this.storage = o.storage;
    this.channel = o.channel ?? null;
    this.iterations = o.kdfIterations ?? KDF_ITERATIONS;
    this.now = o.now ?? (() => new Date());
    this.uuid = o.uuid ?? (() => crypto.randomUUID());
    this.retryDelays = o.retryDelaysMs ?? [1_000, 3_000, 10_000, 30_000, 60_000];
    this.tabId = o.tabId ?? this.uuid();
    this.snapshot = this.buildSnapshot();
  }

  /* ---------------- subscription (useSyncExternalStore) ---------------- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): VaultSnapshot => this.snapshot;

  private buildSnapshot(): VaultSnapshot {
    const unlocked = this.phase === 'unlocked';
    const stored = this.stored;
    const status: VaultStatus = this.phase === 'locking' ? 'locked' : this.phase;
    return {
      status,
      unavailableReason: this.phase === 'unavailable' ? this.unavailableReason : null,
      unavailableDetail: this.phase === 'unavailable' ? this.unavailableDetail : null,
      hasVault: stored !== null,
      totpEnabled: unlocked && this.desired ? this.desired.totpSecret !== null : !!stored?.totpEnabled,
      legacyPasskeys: stored ? legacyPasskeyCount(stored) : 0,
      needsMigration: stored?.version === 1,
      data: unlocked && this.desired ? this.desired.payload : null,
      vaultId: isV2(stored) ? stored.vaultId : null,
      migratedFrom: isV2(stored) ? (stored.migratedFrom ?? null) : null,
      save: { state: this.saveState, lastSavedAt: this.lastSavedAt, unsaved: this.seq > this.committedSeq },
      lockReason: this.lockReason,
      busy: this.busy,
      previous: this.previous,
      notice: this.notice,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((l) => l());
  }

  /* ---------------- lifecycle ---------------- */

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.unsubscribers.push(this.storage.onEvent((e) => this.onStorageEvent(e)));
    if (this.channel) this.unsubscribers.push(this.channel.subscribe((m) => this.onTabMessage(m)));
    await this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.clearRetry();
    this.unsubscribers.splice(0).forEach((u) => u());
    this.listeners.clear();
    this.channel?.close();
    this.storage.close();
  }

  /** Re-read storage metadata (boot, other-tab hints, "retry" on error panels). No-op while unlocked. */
  refresh(): Promise<void> {
    return this.mutex.run(() => this.refreshLocked());
  }

  private async refreshLocked(): Promise<void> {
    if (this.phase === 'unlocked' || this.phase === 'locking') return;
    let raw: unknown;
    try {
      raw = await this.storage.readCurrent();
    } catch (err) {
      this.toUnavailable(
        this.unavailableReason === 'blocked' ? 'blocked' : (err as StorageError).failure === 'version' ? 'superseded' : 'storage',
        err instanceof Error ? err.message : 'Browser storage is unavailable.',
      );
      return;
    }
    await this.readPreviousMeta();
    if (raw === undefined) {
      this.stored = null;
      this.committed = null;
      this.setPhase('no-vault');
      return;
    }
    try {
      const rec = parseStoredRecord(raw);
      this.stored = rec;
      // with an encrypted change still pending, keep its base: if storage moved on,
      // that write must fail its compare-and-swap rather than overwrite
      if (this.seq === this.committedSeq) this.committed = isV2(rec) ? rec : null;
      this.setPhase('locked');
    } catch (err) {
      this.stored = null;
      const unsupported = err instanceof FormatError && err.code === 'unsupported-version';
      this.toUnavailable(unsupported ? 'unsupported-version' : 'invalid-record', (err as Error).message);
    }
  }

  private async readPreviousMeta(): Promise<void> {
    try {
      const prev = (await this.storage.readPrevious()) as { updatedAt?: unknown } | undefined;
      this.previous = prev ? { updatedAt: typeof prev.updatedAt === 'string' ? prev.updatedAt : null } : null;
    } catch {
      this.previous = null;
    }
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    if (p !== 'unavailable') {
      this.unavailableReason = null;
      this.unavailableDetail = null;
    }
    this.emit();
  }

  private toUnavailable(reason: UnavailableReason, detail: string | null): void {
    this.km = null;
    this.desired = null;
    this.phase = 'unavailable';
    this.unavailableReason = reason;
    this.unavailableDetail = detail;
    this.emit();
  }

  private onStorageEvent(e: 'blocked' | 'superseded' | 'closed'): void {
    if (e === 'blocked') {
      if (this.phase === 'loading') this.toUnavailable('blocked', null);
      else this.unavailableReason = 'blocked';
    } else if (e === 'superseded') {
      // a newer KeyHaven version upgraded the database: stop using it (sealing
      // any pending change first so it can still be downloaded, encrypted)
      void this.lock().finally(() => this.toUnavailable('superseded', null));
    }
    // 'closed': the next operation reopens (or fails into conflict / unavailable)
  }

  /* ---------------- tabs ---------------- */

  private post(msg: TabMessage): void {
    this.channel?.post(msg);
  }

  private onTabMessage(msg: TabMessage): void {
    if (msg.tab === this.tabId || this.disposed) return;
    if (msg.t === 'unlocked') {
      if (this.phase === 'unlocked' && this.unlockStamp !== null) {
        const theirs = [msg.at, msg.tab] as const;
        const mine = [this.unlockStamp, this.tabId] as const;
        const newer = theirs[0] > mine[0] || (theirs[0] === mine[0] && theirs[1] > mine[1]);
        if (newer) void this.lock('other-tab');
      }
      return;
    }
    if (this.phase === 'unlocked') {
      if (msg.t === 'committed' && msg.commitId === this.committed?.commitId) return;
      if (this.seq !== this.committedSeq) {
        // our next write will hit a compare-and-swap conflict; surface it now
        this.markConflict();
        return;
      }
      if (msg.t === 'committed') {
        void this.reloadInPlace().then((ok) => (ok ? undefined : this.lock('stale').then(() => this.refresh())));
      } else {
        void this.lock(msg.t === 'deleted' ? 'deleted' : 'replaced').then(() => this.refresh());
      }
      return;
    }
    void this.refresh();
  }

  /**
   * Another tab committed while this one is unlocked and has no unsaved
   * changes: reload the newer record with the same key (same salt/verifier).
   * Returns false when that is not possible (password changed, vault
   * replaced…), in which case the caller locks.
   */
  private reloadInPlace(): Promise<boolean> {
    return this.mutex.run(async () => {
      const km = this.km;
      if (this.phase !== 'unlocked' || !km || this.seq !== this.committedSeq) return false;
      let rec: AnyVaultRecord;
      try {
        rec = parseStoredRecord(await this.storage.readCurrent());
      } catch {
        return false;
      }
      if (!isV2(rec) || rec.vaultId !== this.committed?.vaultId || rec.verifier !== km.verifier) return false;
      if (sameRecord(rec, this.committed)) return true;
      let desired: Desired;
      try {
        desired = { payload: await openPayload(rec, km.key), totpSecret: await openTotpSecret(rec, km.key) };
      } catch {
        return false;
      }
      if (this.phase !== 'unlocked' || this.seq !== this.committedSeq) return false;
      this.desired = desired;
      this.committed = rec;
      this.stored = rec;
      this.lastSavedAt = rec.updatedAt;
      this.emit();
      return true;
    });
  }

  /** Visibility / pageshow hook from the provider: detect writes we may have missed. */
  async checkForExternalChanges(): Promise<void> {
    if (this.phase !== 'unlocked') {
      await this.refresh();
      return;
    }
    let raw: unknown;
    try {
      raw = await this.storage.readCurrent();
    } catch {
      return;
    }
    if (this.phase !== 'unlocked' || sameRecord(raw, this.committed)) return;
    if (this.seq !== this.committedSeq) {
      this.markConflict();
      return;
    }
    if (raw !== undefined && (await this.reloadInPlace())) return;
    await this.lock(raw === undefined ? 'deleted' : 'stale');
    await this.refresh();
  }

  private markConflict(): void {
    if (this.saveState === 'conflict') return;
    this.saveState = 'conflict';
    this.rejectWaiters('conflict');
    this.emit();
  }

  /* ---------------- create / unlock / lock ---------------- */

  async createVault(password: string, o: { entries?: VaultEntry[] } = {}): Promise<'ok' | 'exists' | 'storage-error'> {
    return this.mutex.run(async () => {
      if (this.phase === 'unlocked' || this.phase === 'locking' || this.phase === 'locked') return 'exists';
      const payload: VaultPayload = {
        entries: o.entries ?? [],
        settings: { ...DEFAULT_SETTINGS },
        recoveryCodes: generateBackupCodes(8),
      };
      const { record, key } = await createRecord(password, payload, this.codecOpts());
      try {
        await this.storage.create(record);
      } catch (err) {
        if (err instanceof ExistsError) {
          await this.refreshLocked();
          return 'exists';
        }
        return 'storage-error';
      }
      this.epoch++;
      this.openSession(record, key, { payload, totpSecret: null });
      this.post({ t: 'committed', tab: this.tabId, vaultId: record.vaultId, commitId: record.commitId });
      return 'ok';
    });
  }

  /**
   * Unlock with the master password (+ authenticator code or backup code when
   * the authenticator is enabled). Legacy v1 vaults are migrated — key
   * rotated, passkey wraps removed — in the same atomic write.
   */
  async unlock(password: string, factor?: SecondFactor): Promise<UnlockResult> {
    if (this.phase === 'locking' && this.lockPromise) await this.lockPromise;
    if (this.phase === 'unlocked') return 'ok';
    if (this.phase === 'no-vault') return 'no-vault';
    if (this.phase === 'unavailable' && this.unavailableReason === 'unsupported-version') return 'unsupported-version';
    const e0 = this.epoch;
    this.busy = 'unlocking';
    this.emit();
    try {
      return await this.mutex.run(async () => {
        // 0. an encrypted change from the previous session must land first
        if (this.seq > this.committedSeq) {
          try {
            await this.writePendingLocked();
          } catch {
            return 'unsaved-pending';
          }
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await this.unlockOnce(password, factor, e0);
          if (r !== 'retry') return r;
        }
        return 'storage-error';
      });
    } finally {
      this.busy = null;
      this.emit();
    }
  }

  private async unlockOnce(
    password: string,
    factor: SecondFactor | undefined,
    e0: number,
  ): Promise<UnlockResult | 'retry'> {
    let raw: unknown;
    try {
      raw = await this.storage.readCurrent();
    } catch {
      return 'storage-error';
    }
    if (raw === undefined) {
      this.stored = null;
      this.committed = null;
      this.setPhase('no-vault');
      return 'no-vault';
    }
    let rec: AnyVaultRecord;
    try {
      rec = parseStoredRecord(raw);
    } catch (err) {
      if (err instanceof FormatError && err.code === 'unsupported-version') {
        this.toUnavailable('unsupported-version', err.message);
        return 'unsupported-version';
      }
      return 'corrupt';
    }
    this.stored = rec;

    const km = await deriveForRecord(password, rec);
    if (km.verifier !== rec.verifier) return 'bad-password';
    if (rec.totpEnabled && !factor) return 'totp-required'; // no decryption on this probe

    let payload: VaultPayload;
    try {
      payload = await openPayload(rec, km.key);
    } catch (err) {
      return isCorruption(err) ? 'corrupt' : 'storage-error';
    }
    let totpSecret: string | null = null;
    let totpBroken = false;
    try {
      totpSecret = await openTotpSecret(rec, km.key);
    } catch {
      // damaged authenticator data: only a backup code can get past it (and turns the authenticator off)
      if (!(factor && 'backupCode' in factor)) return 'corrupt';
      totpBroken = true;
    }

    let dirty = false;
    if (rec.totpEnabled) {
      if (factor && 'totp' in factor) {
        if (totpSecret === null || !(await verifyTotp(totpSecret, factor.totp))) return 'totp-invalid';
      } else if (factor && 'backupCode' in factor) {
        const i = findBackupCode(payload.recoveryCodes, factor.backupCode);
        if (i < 0) return 'backup-code-invalid';
        payload = consumeBackupCode(payload, i);
        dirty = true;
      }
    }
    if (totpBroken) {
      totpSecret = null;
      dirty = true;
    }
    if (this.epoch !== e0) return 'superseded';

    let record: VaultRecordV2;
    let key: KeyMaterial = km;
    if (rec.version === 1) {
      this.busy = 'migrating';
      this.emit();
      try {
        const migrated = await migrateV1(rec, password, { payload, totpSecret }, this.codecOpts());
        record = migrated.record;
        key = migrated.key;
        await this.storage.commit(record, raw);
      } catch (err) {
        if (err instanceof ConflictError) return 'retry';
        return 'migration-failed';
      }
    } else if (dirty) {
      const fields = await sealFields(km, payload, totpSecret);
      record = this.nextRecord(rec, fields);
      try {
        await this.storage.commit(record, raw);
      } catch (err) {
        if (err instanceof ConflictError) return 'retry';
        return 'storage-error'; // fail closed: the backup code stays unused, nothing unlocks
      }
    } else {
      record = rec;
    }
    if (this.epoch !== e0) return 'superseded';

    this.notice = totpBroken ? 'totp-reset' : this.notice;
    this.openSession(record, key, { payload, totpSecret });
    if (record !== rec) {
      this.post({ t: 'committed', tab: this.tabId, vaultId: record.vaultId, commitId: record.commitId });
    }
    return 'ok';
  }

  private openSession(record: VaultRecordV2, key: KeyMaterial, desired: Desired): void {
    this.km = key;
    this.desired = desired;
    this.stored = record;
    this.committed = record;
    this.seq = 0;
    this.committedSeq = 0;
    this.sealed = null;
    this.attempted.clear();
    this.saveState = 'saved';
    this.lastSavedAt = record.updatedAt;
    this.lockReason = null;
    this.retryAttempt = 0;
    this.clearRetry();
    this.unlockStamp = this.now().getTime();
    this.phase = 'unlocked';
    this.unavailableReason = null;
    this.emit();
    this.post({ t: 'unlocked', tab: this.tabId, at: this.unlockStamp });
  }

  /**
   * Lock: hide plaintext immediately, seal pending changes with the current
   * key, then drop the key. Idempotent — concurrent callers share one promise.
   */
  lock(reason: LockReason = null): Promise<void> {
    if (this.phase === 'locking' && this.lockPromise) return this.lockPromise;
    if (this.phase !== 'unlocked') return Promise.resolve();
    this.phase = 'locking';
    this.lockReason = reason;
    this.emit();
    const e0 = this.epoch;
    this.lockPromise = (async () => {
      try {
        if (this.keyTransition) await this.keyTransition.catch(noop);
        const km = this.km;
        const d = this.desired;
        const seq = this.seq;
        if (km && d && seq > this.committedSeq && (!this.sealed || this.sealed.seq < seq)) {
          try {
            const fields = await sealFields(km, d.payload, d.totpSecret);
            if (this.epoch === e0 && (!this.sealed || this.sealed.seq < seq)) this.sealed = { seq, fields };
          } catch {
            /* sealing cannot normally fail; if it did, the change is reported as unsaved */
          }
        }
      } finally {
        this.km = null;
        this.desired = null;
        this.unlockStamp = null;
        this.phase = this.stored ? 'locked' : 'no-vault';
        this.lockPromise = null;
        this.emit();
        if (this.seq > this.committedSeq && this.saveState !== 'conflict') void this.pump().catch(noop);
      }
    })();
    return this.lockPromise;
  }

  /* ---------------- mutations & saving ---------------- */

  /** Apply a change to the in-memory payload and schedule an encrypted save. False when not possible. */
  mutate(fn: (p: VaultPayload) => VaultPayload): boolean {
    if (this.phase !== 'unlocked' || !this.desired || this.saveState === 'conflict') return false;
    this.desired = { ...this.desired, payload: fn(this.desired.payload) };
    this.bump();
    return true;
  }

  private bump(): void {
    this.seq++;
    if (this.saveState !== 'error') this.saveState = 'saving';
    this.emit();
    void this.pump().catch(noop);
  }

  /** Resolves when every change made before this call is committed; rejects with SaveError otherwise. */
  flush(): Promise<void> {
    const target = this.seq;
    if (this.committedSeq >= target) return Promise.resolve();
    if (this.saveState === 'conflict') return Promise.reject(new SaveError('conflict'));
    const p = new Promise<void>((resolve, reject) => this.waiters.push({ target, resolve, reject }));
    void this.pump().catch(noop);
    return p;
  }

  /** Retry a failed save now. */
  retrySave(): void {
    if (this.saveState === 'conflict') return;
    this.clearRetry();
    void this.pump().catch(noop);
  }

  /** Drop changes that could not be saved (explicit user choice). */
  async discardUnsaved(): Promise<void> {
    await this.mutex.run(async () => {
      this.sealed = null;
      this.committedSeq = this.seq;
      this.attempted.clear();
      this.clearRetry();
      this.rejectWaiters('discarded');
      this.saveState = 'saved';
      this.emit();
    });
    if (this.phase === 'unlocked') await this.lock('conflict');
    await this.refresh();
  }

  /** The pending (unsaved) changes as an ENCRYPTED backup file, or null when nothing is pending. */
  unsavedBackupText(): string | null {
    if (this.seq <= this.committedSeq || !this.committed) return null;
    const fields = this.sealed?.fields;
    if (!fields || fields.verifier !== this.committed.verifier) return null;
    return serializeBackupFile(this.nextRecord(this.committed, fields), this.now().toISOString());
  }

  private pump(): Promise<void> {
    if (this.pumpPromise) {
      this.pumpAgain = true;
      return this.pumpPromise;
    }
    const run = this.mutex.run(() => this.writePendingLocked());
    this.pumpPromise = run.finally(() => {
      this.pumpPromise = null;
      if (this.pumpAgain) {
        this.pumpAgain = false;
        if (this.seq > this.committedSeq && this.saveState === 'saving') void this.pump().catch(noop);
      }
    });
    return this.pumpPromise;
  }

  private nextRecord(base: VaultRecordV2, fields: SealedFields): VaultRecordV2 {
    const next: VaultRecordV2 = {
      ...base,
      ...fields,
      revision: base.revision + 1,
      commitId: this.uuid(),
      updatedAt: this.now().toISOString(),
    };
    if (!fields.totpSecretEncrypted) delete next.totpSecretEncrypted;
    return next;
  }

  /** Must run under the mutex. Writes until storage holds everything mutated so far. */
  private async writePendingLocked(): Promise<void> {
    while (this.seq > this.committedSeq) {
      if (this.saveState === 'conflict') throw new SaveError('conflict');
      const e0 = this.epoch;
      const km = this.km;
      const d = this.desired;
      const seq = this.seq;
      if (km && d && (!this.sealed || this.sealed.seq < seq)) {
        const fields = await sealFields(km, d.payload, d.totpSecret);
        if (this.epoch !== e0) return;
        if (!this.sealed || this.sealed.seq < seq) this.sealed = { seq, fields };
      }
      const sealed = this.sealed;
      const base = this.committed;
      if (!sealed || !base || sealed.fields.verifier !== base.verifier) {
        // nothing writable (should not happen) — never write mixed-key data
        this.failSave('storage');
        throw new SaveError('storage');
      }
      const next = this.nextRecord(base, sealed.fields);
      this.attempted.set(next.commitId, sealed.seq);
      if (this.saveState !== 'saving') {
        this.saveState = 'saving';
        this.emit();
      }
      try {
        await this.storage.commit(next, base);
      } catch (err) {
        if (this.epoch !== e0) return;
        if (err instanceof ConflictError && (await this.adoptIfOurs())) continue;
        if (err instanceof ConflictError) {
          this.failSave('conflict');
          throw new SaveError('conflict');
        }
        this.failSave('storage');
        this.scheduleRetry();
        throw new SaveError('storage');
      }
      if (this.epoch !== e0) return;
      this.adopt(next, sealed.seq);
    }
    if (this.saveState !== 'saved' && this.saveState !== 'conflict') {
      this.saveState = 'saved';
      this.emit();
    }
  }

  /** A write that "failed" (e.g. timed out) may have landed: adopt it if the stored commitId is ours. */
  private async adoptIfOurs(): Promise<boolean> {
    let raw: unknown;
    try {
      raw = await this.storage.readCurrent();
    } catch {
      return false;
    }
    const cur = raw as VaultRecordV2 | undefined;
    if (!cur || cur.version !== 2 || cur.vaultId !== this.committed?.vaultId) return false;
    const seq = this.attempted.get(cur.commitId);
    if (seq === undefined) return false;
    this.adopt(cur, seq);
    return true;
  }

  private adopt(record: VaultRecordV2, seq: number): void {
    this.committed = record;
    this.stored = record;
    this.committedSeq = Math.max(this.committedSeq, seq);
    if (this.sealed && this.sealed.seq <= this.committedSeq) this.sealed = null;
    this.attempted.clear();
    this.lastSavedAt = record.updatedAt;
    this.retryAttempt = 0;
    this.clearRetry();
    if (this.seq <= this.committedSeq) this.saveState = 'saved';
    const done = this.waiters.filter((w) => w.target <= this.committedSeq);
    this.waiters = this.waiters.filter((w) => w.target > this.committedSeq);
    done.forEach((w) => w.resolve());
    this.emit();
    this.post({ t: 'committed', tab: this.tabId, vaultId: record.vaultId, commitId: record.commitId });
  }

  private failSave(reason: 'storage' | 'conflict'): void {
    this.saveState = reason === 'conflict' ? 'conflict' : 'error';
    this.rejectWaiters(reason);
    this.emit();
  }

  private rejectWaiters(reason: 'storage' | 'conflict' | 'discarded'): void {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((x) => x.reject(new SaveError(reason)));
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.disposed) return;
    const delay = this.retryDelays[Math.min(this.retryAttempt, this.retryDelays.length - 1)];
    if (delay === undefined) return;
    this.retryAttempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.pump().catch(noop);
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private codecOpts() {
    return { iterations: this.iterations, now: this.now().toISOString(), uuid: this.uuid };
  }

  /* ---------------- authenticator (TOTP) + backup codes ---------------- */

  /** Check a second factor against the unlocked vault; consumes a valid backup code. */
  private async checkFactor(factor: SecondFactor | undefined): Promise<boolean> {
    const d = this.desired;
    if (!d || d.totpSecret === null) return true; // nothing to check
    if (!factor) return false;
    if ('totp' in factor) return verifyTotp(d.totpSecret, factor.totp);
    const i = findBackupCode(d.payload.recoveryCodes, factor.backupCode);
    if (i < 0) return false;
    this.desired = { ...d, payload: consumeBackupCode(d.payload, i) };
    this.bump();
    return true;
  }

  /**
   * Enable the authenticator, or re-enroll it (re-enrolling requires the
   * CURRENT authenticator code or a backup code).
   */
  async enableTotp(secret: string, code: string, current?: SecondFactor): Promise<FactorResult> {
    if (this.phase !== 'unlocked' || !this.desired) return 'locked';
    if (this.desired.totpSecret !== null) {
      if (!current) return 'factor-required';
      if (!(await this.checkFactor(current))) return 'invalid-code';
    }
    if (!(await verifyTotp(secret, code))) return 'invalid-code';
    if (this.phase !== 'unlocked' || !this.desired) return 'locked';
    this.desired = { ...this.desired, totpSecret: secret };
    this.bump();
    try {
      await this.flush();
      return 'ok';
    } catch {
      return 'save-failed';
    }
  }

  /** Turn the authenticator off — requires its current code or a backup code. */
  async disableTotp(factor: SecondFactor): Promise<FactorResult> {
    if (this.phase !== 'unlocked' || !this.desired) return 'locked';
    if (this.desired.totpSecret === null) return 'ok';
    if (!(await this.checkFactor(factor))) return 'invalid-code';
    if (this.phase !== 'unlocked' || !this.desired) return 'locked';
    this.desired = { ...this.desired, totpSecret: null };
    this.bump();
    try {
      await this.flush();
      return 'ok';
    } catch {
      return 'save-failed';
    }
  }

  regenerateBackupCodes(): Promise<void> {
    if (!this.mutate((p) => ({ ...p, recoveryCodes: generateBackupCodes(8) }))) {
      return Promise.reject(new SaveError('discarded', 'The vault is locked.'));
    }
    return this.flush();
  }

  dismissNotice(): void {
    this.notice = null;
    this.emit();
  }

  /* ---------------- master password ---------------- */

  async changePassword(current: string, next: string): Promise<ChangePasswordResult> {
    if (this.phase !== 'unlocked') return 'locked';
    if (this.saveState === 'conflict') return 'conflict';
    let endTransition: () => void = noop;
    this.keyTransition = new Promise<void>((r) => (endTransition = r));
    this.busy = 'rekeying';
    this.emit();
    try {
      const result = await this.mutex.run(async (): Promise<ChangePasswordResult> => {
        if (this.phase !== 'unlocked' && this.phase !== 'locking') return 'locked';
        try {
          await this.writePendingLocked();
        } catch (err) {
          if (err instanceof SaveError && err.reason === 'conflict') return 'conflict';
          // storage error: the rekey below re-encrypts the latest in-memory state anyway
        }
        const base = this.committed;
        const d = this.desired;
        if (!base || !d) return 'locked';
        const check = await deriveForRecord(current, base);
        if (check.verifier !== base.verifier) return 'bad-password';
        const e0 = this.epoch;
        const seq = this.seq;
        const { record, key } = await rekey(base, next, d, this.codecOpts());
        try {
          await this.storage.commit(record, base);
        } catch (err) {
          if (err instanceof ConflictError) {
            this.markConflict();
            return 'conflict';
          }
          return 'storage-error';
        }
        if (this.epoch !== e0) return 'conflict';
        // swap key + base atomically; any seal made with the old key is now void
        this.km = key;
        this.sealed = null;
        this.adopt(record, seq);
        if (this.seq > this.committedSeq) this.saveState = 'saving';
        this.emit();
        return 'ok';
      });
      if (this.seq > this.committedSeq) void this.pump().catch(noop);
      return result;
    } finally {
      this.keyTransition = null;
      endTransition();
      this.busy = null;
      this.emit();
    }
  }

  /* ---------------- backup: export / import / previous ---------------- */

  /** Save pending changes, then export exactly the record now in storage (still encrypted). */
  async exportBackup(): Promise<ExportResult> {
    if (this.phase !== 'unlocked') return { ok: false, reason: 'locked', unsavedText: null };
    return this.mutex.run(async (): Promise<ExportResult> => {
      try {
        await this.writePendingLocked();
      } catch (err) {
        const reason = err instanceof SaveError && err.reason === 'conflict' ? 'conflict' : 'storage';
        return { ok: false, reason, unsavedText: this.unsavedBackupText() };
      }
      let raw: unknown;
      try {
        raw = await this.storage.readCurrent();
      } catch {
        return { ok: false, reason: 'storage', unsavedText: null };
      }
      if (!this.committed || !sameRecord(raw, this.committed)) {
        return { ok: false, reason: 'conflict', unsavedText: null };
      }
      return { ok: true, text: serializeBackupFile(raw as VaultRecordV2, this.now().toISOString()) };
    });
  }

  /**
   * Import an encrypted backup. Everything is verified IN MEMORY first (file
   * format, password, decryption, contents); only then is the current vault
   * replaced — atomically, keeping it in the `previous` slot. Legacy v1
   * backups are migrated (key rotated, passkey wraps dropped) before storage.
   */
  async importBackup(text: string, password: string): Promise<ImportResult> {
    const allowed =
      this.phase === 'unlocked' ||
      this.phase === 'no-vault' ||
      (this.phase === 'unavailable' && this.unavailableReason === 'invalid-record');
    if (!allowed) return { ok: false, reason: 'not-allowed' };

    // Snapshot what this import is meant to replace BEFORE the slow verification.
    // If the vault is deleted, replaced or restored meanwhile (here or in
    // another tab), the import is cancelled instead of re-creating a vault.
    const e0 = this.epoch;
    const startedUnlocked = this.phase === 'unlocked';
    const startVaultId = this.committed?.vaultId ?? null;
    let startExpected: unknown = undefined; // no-vault: nothing may appear meanwhile
    if (this.phase === 'unavailable') {
      try {
        startExpected = await this.storage.readCurrent(); // the unreadable record being replaced
      } catch {
        return { ok: false, reason: 'storage-error' };
      }
    }

    let rec: AnyVaultRecord;
    try {
      rec = parseBackupFile(text).record;
    } catch (err) {
      const unsupported = err instanceof FormatError && err.code === 'unsupported-version';
      return {
        ok: false,
        reason: unsupported ? 'unsupported-version' : 'invalid-file',
        detail: err instanceof Error ? err.message : undefined,
      };
    }
    this.busy = 'importing';
    this.emit();
    try {
      const km = await deriveForRecord(password, rec);
      if (km.verifier !== rec.verifier) return { ok: false, reason: 'bad-password' };
      let opened: Desired;
      try {
        opened = { payload: await openPayload(rec, km.key), totpSecret: await openTotpSecret(rec, km.key) };
      } catch {
        return { ok: false, reason: 'corrupt' };
      }
      let next: VaultRecordV2;
      let key: KeyMaterial = km;
      const migrated = rec.version === 1;
      if (rec.version === 1) {
        const m = await migrateV1(rec, password, opened, this.codecOpts());
        next = m.record;
        key = m.key;
      } else {
        next = {
          ...rec,
          revision: Math.max(rec.revision, this.committed?.revision ?? 0) + 1,
          commitId: this.uuid(),
        };
      }

      return await this.mutex.run(async (): Promise<ImportResult> => {
        if (this.epoch !== e0) return { ok: false, reason: 'conflict' }; // deleted/replaced/restored here
        let expected: unknown = startExpected;
        if (startedUnlocked) {
          if (this.seq > this.committedSeq) {
            try {
              await this.writePendingLocked();
            } catch {
              return { ok: false, reason: 'current-unsaved' };
            }
          }
          // still the same vault lineage this tab had open? (another tab may have deleted it)
          if (!this.committed || this.committed.vaultId !== startVaultId) return { ok: false, reason: 'conflict' };
          expected = this.committed;
        }
        // compare-and-swap against that starting state: anything else → conflict, nothing replaced
        try {
          await this.storage.replace(next, expected);
        } catch (err) {
          return { ok: false, reason: err instanceof ConflictError ? 'conflict' : 'storage-error' };
        }
        this.epoch++;
        this.resetSessionState();
        this.stored = next;
        this.committed = next;
        await this.readPreviousMeta();
        this.post({ t: 'replaced', tab: this.tabId });
        if (next.totpEnabled) {
          // the authenticator check applies to the imported vault too
          this.lockReason = 'replaced';
          this.setPhase('locked');
          return { ok: true, unlocked: false, migrated };
        }
        this.openSession(next, key, opened);
        return { ok: true, unlocked: true, migrated };
      });
    } finally {
      this.busy = null;
      this.emit();
    }
  }

  /** Swap the current vault with the one kept by the last import/restore. Locks. */
  async restorePrevious(): Promise<'ok' | 'none' | 'current-unsaved' | 'conflict' | 'storage-error'> {
    const r = await this.mutex.run(async () => {
      if (this.phase === 'unlocked' || this.phase === 'locking') {
        try {
          await this.writePendingLocked();
        } catch {
          return 'current-unsaved' as const;
        }
      }
      let prev: unknown;
      let expected: unknown;
      try {
        prev = await this.storage.readPrevious();
        expected = this.phase === 'unlocked' ? this.committed : await this.storage.readCurrent();
      } catch {
        return 'storage-error' as const;
      }
      if (prev === undefined) return 'none' as const;
      try {
        await this.storage.swapPrevious(expected);
      } catch (err) {
        return err instanceof ConflictError ? ('conflict' as const) : ('storage-error' as const);
      }
      this.epoch++;
      this.resetSessionState();
      this.lockReason = 'replaced';
      this.phase = 'locked';
      this.post({ t: 'replaced', tab: this.tabId });
      await this.refreshLocked();
      return 'ok' as const;
    });
    return r;
  }

  async discardPrevious(): Promise<void> {
    await this.mutex.run(async () => {
      await this.storage.discardPrevious();
      this.previous = null;
      this.emit();
    });
  }

  /** Permanently delete the vault on this device (current + previous + pending changes). */
  async destroy(): Promise<void> {
    this.epoch++;
    this.resetSessionState();
    this.rejectWaiters('discarded');
    this.emit();
    await this.mutex.run(async () => {
      await this.storage.deleteAll();
      this.stored = null;
      this.committed = null;
      this.previous = null;
      this.lockReason = null;
      this.notice = null;
      this.setPhase('no-vault');
    });
    this.post({ t: 'deleted', tab: this.tabId });
  }

  /** Drop key, plaintext and any pending/sealed state (vault replaced or deleted). */
  private resetSessionState(): void {
    this.km = null;
    this.desired = null;
    this.sealed = null;
    this.seq = 0;
    this.committedSeq = 0;
    this.attempted.clear();
    this.clearRetry();
    this.retryAttempt = 0;
    this.saveState = 'saved';
    this.unlockStamp = null;
    this.lockPromise = null;
    if (this.phase === 'unlocked' || this.phase === 'locking') this.phase = 'locked';
  }
}
