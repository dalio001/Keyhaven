/** Typed storage/save errors (string-literal `kind`s — no enums, see erasableSyntaxOnly). */

/** The stored record is not the one this write was based on (another tab/import/delete got there first). */
export class ConflictError extends Error {
  readonly kind = 'conflict' as const;
  constructor(message = 'The vault was changed elsewhere (another tab, an import or a deletion).') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Refused to create a vault because one already exists — creation never overwrites. */
export class ExistsError extends Error {
  readonly kind = 'exists' as const;
  constructor(message = 'A vault already exists on this device.') {
    super(message);
    this.name = 'ExistsError';
  }
}

export type StorageFailure = 'unavailable' | 'blocked' | 'version' | 'timeout' | 'quota' | 'io';

/** Browser storage failed (quota, I/O, blocked upgrade, timeout…). */
export class StorageError extends Error {
  readonly kind = 'storage' as const;
  readonly failure: StorageFailure;
  constructor(failure: StorageFailure, message: string, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.failure = failure;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export type SaveErrorReason = 'storage' | 'conflict' | 'discarded';

/** Rejection reason for `flush()` when pending changes could not be committed. */
export class SaveError extends Error {
  readonly kind = 'save' as const;
  readonly reason: SaveErrorReason;
  constructor(reason: SaveErrorReason, message?: string) {
    super(
      message ??
        (reason === 'conflict'
          ? 'Changes could not be saved because the vault was changed elsewhere.'
          : reason === 'discarded'
            ? 'Unsaved changes were discarded.'
            : 'Changes could not be saved to browser storage.'),
    );
    this.name = 'SaveError';
    this.reason = reason;
  }
}
