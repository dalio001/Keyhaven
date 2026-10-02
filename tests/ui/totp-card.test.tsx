// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { VaultProvider } from '@/providers/VaultProvider';
import TotpCard from '@/components/settings/TotpCard';
import { freshVault } from '../helpers/controller';

/** relative luminance of a #RRGGBB colour (0 = black, 1 = white) */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('Settings authenticator setup', () => {
  it('draws the QR code dark-on-light, which every scanner app can read', async () => {
    const { c } = await freshVault();
    render(
      <VaultProvider controller={c}>
        <MemoryRouter>
          <TotpCard />
        </MemoryRouter>
      </VaultProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Set up authenticator/ }));
    const svg = await screen.findByLabelText('TOTP enrollment QR code');
    const [bg, fg] = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('fill') ?? '');
    expect(bg).toMatch(/^#[0-9A-Fa-f]{6}$/); // an opaque light background, not "transparent"
    expect(luminance(bg) - luminance(fg)).toBeGreaterThan(0.6);
  });
});
