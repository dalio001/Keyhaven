// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { VaultProvider } from '@/providers/VaultProvider';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import type { VaultController } from '@/lib/store/controller';
import { freshVault, started } from '../helpers/controller';

afterEach(cleanup);

function renderNavbar(c: VaultController) {
  render(
    <VaultProvider controller={c}>
      <MemoryRouter initialEntries={['/about']}>
        <Navbar />
      </MemoryRouter>
    </VaultProvider>,
  );
  return within(screen.getByRole('banner'));
}

describe('header follows the vault (KH-11)', () => {
  it('unlocked: "Open vault" and "Lock", no "Create your vault"', async () => {
    const { c } = await freshVault();
    const header = renderNavbar(c);
    expect(await header.findByRole('link', { name: /open vault/i })).toHaveProperty('pathname', '/vault');
    expect(header.queryByRole('button', { name: /create your vault/i })).toBeNull();
    expect(header.queryByRole('button', { name: /unlock vault/i })).toBeNull();
    fireEvent.click(header.getByRole('button', { name: /^lock$/i }));
    await waitFor(() => expect(c.getSnapshot().status).toBe('locked'));
    expect(await header.findByRole('link', { name: /unlock vault/i })).toBeTruthy();
  });

  it('locked: "Unlock vault" only — a vault already exists', async () => {
    const { c } = await freshVault();
    await c.lock();
    const header = renderNavbar(c);
    expect(await header.findByRole('link', { name: /unlock vault/i })).toHaveProperty('pathname', '/unlock');
    expect(header.queryByRole('link', { name: /create your vault/i })).toBeNull();
    expect(header.queryByRole('button', { name: /^lock$/i })).toBeNull();
  });

  it('no vault yet: "Create your vault" as before', async () => {
    const { c } = await started();
    const header = renderNavbar(c);
    expect(await header.findByRole('link', { name: /create your vault/i })).toBeTruthy();
    expect(header.queryByRole('link', { name: /open vault/i })).toBeNull();
  });
});

describe('footer (KH-10)', () => {
  it('Privacy goes to the privacy section of About; no placeholder Terms link', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );
    const privacy = screen.getByRole('link', { name: /privacy/i }) as HTMLAnchorElement;
    expect(privacy.getAttribute('href')).toBe('/about#privacy');
    expect(screen.queryByRole('link', { name: /^terms$/i })).toBeNull();
  });
});
