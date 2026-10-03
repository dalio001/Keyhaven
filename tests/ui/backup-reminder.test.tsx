// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { VaultProvider } from '@/providers/VaultProvider';
import Vault from '@/pages/Vault';
import { BACKUP_SNOOZE_KEY } from '@/lib/backupReminder';
import { LAST_EXPORT_KEY } from '@/lib/lastExport';
import { cloneSampleEntries } from '@/lib/sampleData';
import { addEntry, entry, freshVault } from '../helpers/controller';

type Controller = Awaited<ReturnType<typeof freshVault>>['c'];

function renderVault(c: Controller) {
  return render(
    <VaultProvider controller={c}>
      <MemoryRouter initialEntries={['/vault']}>
        <Routes>
          <Route path="/vault" element={<Vault />} />
          <Route path="/settings" element={<p>settings page</p>} />
        </Routes>
      </MemoryRouter>
    </VaultProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('backup reminder on the vault page (Phase 4)', () => {
  it('shows when you have your own data and never exported; Back up now opens Settings', async () => {
    const { c } = await freshVault();
    addEntry(c, entry('mine', { title: 'My bank' }));
    renderVault(c);
    expect(await screen.findByText(/You haven't exported an encrypted backup yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Back up now' }));
    expect(await screen.findByText('settings page')).toBeTruthy();
  });

  it('"Remind me in 2 weeks" hides it and remembers', async () => {
    const { c } = await freshVault();
    addEntry(c, entry('mine'));
    const view = renderVault(c);
    fireEvent.click(await screen.findByRole('button', { name: 'Remind me in 2 weeks' }));
    expect(screen.queryByRole('status', { name: 'Backup reminder' })).toBeNull();
    expect(Date.parse(localStorage.getItem(BACKUP_SNOOZE_KEY)!)).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    view.unmount();
    renderVault(c);
    await screen.findByRole('button', { name: /New login|Add/ }).catch(() => undefined);
    expect(screen.queryByRole('status', { name: 'Backup reminder' })).toBeNull();
  });

  it('not shown with only the sample logins, or after a recent export', async () => {
    const samples = await freshVault();
    samples.c.mutate((p) => ({ ...p, entries: cloneSampleEntries() }));
    const view = renderVault(samples.c);
    await screen.findByText('GitHub');
    expect(screen.queryByRole('status', { name: 'Backup reminder' })).toBeNull();
    view.unmount();

    const { c } = await freshVault();
    addEntry(c, entry('mine', { title: 'My bank' }));
    localStorage.setItem(LAST_EXPORT_KEY, new Date(Date.now() - 2 * 86_400_000).toISOString());
    renderVault(c);
    await screen.findByText('My bank');
    expect(screen.queryByRole('status', { name: 'Backup reminder' })).toBeNull();
  });
});
