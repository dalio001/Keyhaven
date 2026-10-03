// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { VaultProvider } from '@/providers/VaultProvider';
import Settings from '@/pages/Settings';
import { PW, freshVault } from '../helpers/controller';

let kept = false;
const storage = {
  persisted: vi.fn(async () => kept),
  persist: vi.fn(async () => {
    kept = true;
    return true;
  }),
};

beforeEach(() => {
  kept = false;
  storage.persisted.mockClear();
  storage.persist.mockClear();
  Object.defineProperty(navigator, 'storage', { value: storage, configurable: true });
});
afterEach(() => {
  delete (navigator as { storage?: unknown }).storage;
});

function renderApp(c: Awaited<ReturnType<typeof freshVault>>['c'], path = '/elsewhere') {
  return render(
    <VaultProvider controller={c}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<p>page</p>} />
        </Routes>
      </MemoryRouter>
    </VaultProvider>,
  );
}

describe('keeping the vault in the browser (Phase 4)', () => {
  it('asks once per page load after unlock, never while locked', async () => {
    const { c } = await freshVault();
    await c.lock();
    renderApp(c);
    await screen.findByText('page');
    await act(async () => {});
    expect(storage.persist).not.toHaveBeenCalled();
    await act(async () => {
      await c.unlock(PW);
    });
    expect(storage.persist).toHaveBeenCalledTimes(1);
    await act(async () => {
      await c.lock();
    });
    await act(async () => {
      await c.unlock(PW);
    });
    expect(storage.persist).toHaveBeenCalledTimes(1);
  });

  it('Settings → Vault & data shows whether the browser keeps it, and can ask', async () => {
    const { c } = await freshVault();
    storage.persist.mockImplementationOnce(async () => false); // the automatic request was declined
    renderApp(c, '/settings?tab=data');
    expect(await screen.findByText('Browser storage')).toBeTruthy();
    expect(await screen.findByText('The browser may clear it when space runs low')).toBeTruthy();
    expect(screen.getByText(/Not a backup/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask the browser to keep it' }));
    expect(await screen.findByText('Kept until you delete it')).toBeTruthy();
  });
});
