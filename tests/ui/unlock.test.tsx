// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { getTotpCode } from '@/lib/totp';
import { VaultProvider, useVault } from '@/providers/VaultProvider';
import UnlockMode from '@/components/unlock/UnlockMode';
import { PW, entry, freshVault, readStoredPayload } from '../helpers/controller';

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

async function lockedTotpVault() {
  const x = await freshVault();
  expect(await x.c.enableTotp(SECRET, (await getTotpCode(SECRET)).code)).toBe('ok');
  const codes = [...x.c.getSnapshot().data!.recoveryCodes];
  await x.c.lock();
  return { ...x, codes };
}

function renderUnlock(c: Awaited<ReturnType<typeof lockedTotpVault>>['c']) {
  const onSuccess = vi.fn();
  render(
    <VaultProvider controller={c}>
      <MemoryRouter>
        <UnlockMode onSuccess={onSuccess} onSwitchToCreate={() => undefined} onFail={() => undefined} />
      </MemoryRouter>
    </VaultProvider>,
  );
  return { onSuccess };
}

describe('UnlockMode (UI claims match behavior)', () => {
  beforeEach(() => localStorage.clear());

  it('a backup code replaces the authenticator code, only after the master password', async () => {
    const { c, codes, storage } = await lockedTotpVault();
    const { onSuccess } = renderUnlock(c);

    fireEvent.change(screen.getByLabelText('Master password'), { target: { value: PW } });
    fireEvent.click(screen.getByRole('button', { name: /unlock vault/i }));
    await screen.findByText(/master password verified/i);

    fireEvent.click(screen.getByRole('button', { name: /lost your phone\? use a backup code/i }));
    fireEvent.change(screen.getByLabelText(/authenticator backup code/i), { target: { value: codes[0] } });
    fireEvent.click(screen.getByRole('button', { name: /^unlock$/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(c.getSnapshot().status).toBe('unlocked');
    expect((await readStoredPayload(storage)).recoveryCodes).not.toContain(codes[0]);
  });

  it('offers no way to "recover" a forgotten master password and says so', async () => {
    const { c } = await lockedTotpVault();
    renderUnlock(c);
    expect(screen.queryByText(/unlock with recovery code/i)).toBeNull();
    expect(screen.queryByRole('tab', { name: /passkey/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /forgot master password/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/cannot reset or recover it/i);
    expect(dialog.textContent).toMatch(/cannot open the vault\s+without the master password/i);
    expect(dialog.querySelector('input[placeholder="XXXX-XXXX-XXXX"]')).toBeNull();
  });
});

function SaveHarness() {
  const v = useVault();
  return (
    <div>
      <span data-testid="status">{v.status}</span>
      <span data-testid="save">{v.save.state}</span>
      <button onClick={() => v.addEntry(entry('ui-entry'))}>add</button>
      <button onClick={() => void v.lock()}>lock</button>
    </div>
  );
}

describe('VaultProvider wiring', () => {
  it('reports saving → saved only after the commit, and warns before unload while unsaved', async () => {
    const x = await freshVault();
    render(
      <VaultProvider controller={x.c}>
        <SaveHarness />
      </VaultProvider>,
    );
    expect(screen.getByTestId('status').textContent).toBe('unlocked');
    const gate = x.storage.gate('commit');
    fireEvent.click(screen.getByText('add'));
    await gate.reached;
    expect(screen.getByTestId('save').textContent).toBe('saving');

    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByText('lock')); // lock while the write is still in flight
    await act(async () => {
      gate.release();
      await x.c.flush();
    });
    expect(screen.getByTestId('status').textContent).toBe('locked');
    expect(screen.getByTestId('save').textContent).toBe('saved');
    expect((await readStoredPayload(x.storage)).entries.map((e) => e.id)).toEqual(['ui-entry']);
  });
});
