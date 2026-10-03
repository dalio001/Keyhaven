import { describe, expect, it, vi } from 'vitest';
import { persistenceState, requestPersistence } from '@/lib/persistence';

const manager = (persisted: boolean, grants = true) => ({
  persisted: vi.fn(async () => persisted),
  persist: vi.fn(async () => grants),
});

describe('asking the browser to keep the vault (navigator.storage.persist)', () => {
  it('asks only when the storage is not kept already', async () => {
    const kept = manager(true);
    expect(await requestPersistence(kept)).toBe('persisted');
    expect(kept.persist).not.toHaveBeenCalled();

    const notYet = manager(false, true);
    expect(await requestPersistence(notYet)).toBe('persisted');
    expect(notYet.persist).toHaveBeenCalledTimes(1);

    expect(await requestPersistence(manager(false, false))).toBe('not-persisted');
  });

  it('reports the state without asking', async () => {
    const m = manager(false);
    expect(await persistenceState(m)).toBe('not-persisted');
    expect(m.persist).not.toHaveBeenCalled();
    expect(await persistenceState(manager(true))).toBe('persisted');
  });

  it('never throws: no API, or an API that fails, is "unsupported"', async () => {
    expect(await requestPersistence(null)).toBe('unsupported');
    expect(await persistenceState(null)).toBe('unsupported');
    const broken = { persisted: vi.fn(async () => { throw new Error('denied'); }), persist: vi.fn(async () => true) };
    expect(await requestPersistence(broken)).toBe('unsupported');
    expect(await persistenceState(broken)).toBe('unsupported');
    expect(await requestPersistence()).toBe('unsupported'); // node: no navigator.storage
  });
});
