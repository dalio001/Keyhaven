// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { VaultProvider } from '@/providers/VaultProvider';
import Vault from '@/pages/Vault';
import { clearSecret, offerSecret } from '@/lib/handoff';
import { addEntry, entry, freshVault } from '../helpers/controller';

const SECRET = 'Synthetic-Gen-Secret-42';
const seen: string[] = [];

function LocationProbe() {
  const loc = useLocation();
  seen.push(loc.pathname + loc.search + loc.hash);
  return null;
}

async function openVaultAt(path: string) {
  const x = await freshVault();
  addEntry(x.c, entry('nf-05', { title: 'Netflix', favorite: false }));
  addEntry(x.c, entry('gh-01', { title: 'GitHub', favorite: true }));
  render(
    <VaultProvider controller={x.c}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path="/vault" element={<Vault />} />
        </Routes>
      </MemoryRouter>
    </VaultProvider>,
  );
  return x;
}

afterEach(() => {
  clearSecret();
  seen.length = 0;
});

describe('links into the vault open what they promise', () => {
  it('KH-02: /vault?new=1 opens the new-login form, prefilled with a generated password handed over in memory', async () => {
    offerSecret(SECRET);
    await openVaultAt('/vault?new=1');
    const dialog = await screen.findByRole('dialog', { name: 'New login' });
    expect((within(dialog).getByLabelText('Password') as HTMLInputElement).value).toBe(SECRET);
    await waitFor(() => expect(seen.at(-1)).toBe('/vault')); // link parameters are removed afterwards
  });

  it('KH-01: the secret never appears in the address, and an old ?seed= link is ignored and removed', async () => {
    sessionStorage.setItem('kh:generator-seed', 'left-by-an-older-build');
    await openVaultAt(`/vault?new=1&seed=${encodeURIComponent('leaked-in-url')}`);
    const dialog = await screen.findByRole('dialog', { name: 'New login' });
    expect((within(dialog).getByLabelText('Password') as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(seen.at(-1)).toBe('/vault'));
    expect(sessionStorage.getItem('kh:generator-seed')).toBeNull(); // the copy older builds kept is gone too
  });

  it('KH-03: /vault?edit=<id> opens that login in the editor', async () => {
    await openVaultAt('/vault?edit=nf-05');
    expect(await screen.findByRole('dialog', { name: 'Edit Netflix' })).toBeTruthy();
  });

  it('KH-09: /vault?search=1 opens search', async () => {
    await openVaultAt('/vault?search=1');
    expect(await screen.findByPlaceholderText('Search your vault…')).toBeTruthy();
  });

  it('?filter=favorites shows only favorites', async () => {
    await openVaultAt('/vault?filter=favorites');
    expect(await screen.findByRole('button', { name: 'Open GitHub details' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Netflix details' })).toBeNull();
  });
});
