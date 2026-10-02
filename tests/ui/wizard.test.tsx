// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { getTotpCode } from '@/lib/totp';
import { VaultProvider } from '@/providers/VaultProvider';
import CreateWizard from '@/components/unlock/CreateWizard';
import { started } from '../helpers/controller';

const STRONG = 'synthetic Orbit-Lantern quartz 7731 meadow';

function renderWizard(c: Awaited<ReturnType<typeof started>>['c']) {
  render(
    <VaultProvider controller={c}>
      <MemoryRouter>
        <CreateWizard
          onSuccess={() => undefined}
          onBackToUnlock={() => undefined}
          onStepChange={() => undefined}
          onVaultCreated={() => undefined}
          hasVault={false}
          onSwitchToUnlock={() => undefined}
        />
      </MemoryRouter>
    </VaultProvider>,
  );
}

async function toAuthenticatorStep(c: Awaited<ReturnType<typeof started>>['c']) {
  renderWizard(c);
  fireEvent.change(screen.getByLabelText('New master password'), { target: { value: STRONG } });
  fireEvent.change(screen.getByLabelText('Confirm master password'), { target: { value: STRONG } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Step 2 of 3');
  fireEvent.click(await screen.findByRole('radio', { name: /Authenticator app/ }, { timeout: 3000 }));
  await screen.findByLabelText('Six-digit authenticator code');
}

describe('CreateWizard authenticator step', () => {
  it('the idle auto-lock does not fire while the user is scanning the QR code', async () => {
    const { c } = await started();
    await toAuthenticatorStep(c);
    expect(c.getSnapshot().status).toBe('unlocked');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(Date.now() + 6 * 60_000)); // 6 minutes with no clicks or keys
      await act(() => new Promise<void>((r) => setTimeout(r, 1500))); // let the 1s auto-lock tick run
      expect(c.getSnapshot().status).toBe('unlocked');
    } finally {
      vi.useRealTimers();
    }
  });

  it('if the vault locks mid-setup, the wizard says so instead of rejecting the code', async () => {
    const { c } = await started();
    await toAuthenticatorStep(c);
    await act(() => c.lock('other-tab'));
    await screen.findByText('KeyHaven locked during setup.');
    expect(screen.getByRole('button', { name: 'Unlock vault' })).toBeTruthy();
    expect(screen.queryByText(/didn't match/)).toBeNull();
    expect(screen.queryByLabelText('Six-digit authenticator code')).toBeNull(); // the stale QR/code entry is gone
  });

  it('shows a visible label telling the user where to type the code', async () => {
    const { c } = await started();
    renderWizard(c);
    fireEvent.change(screen.getByLabelText('New master password'), { target: { value: STRONG } });
    fireEvent.change(screen.getByLabelText('Confirm master password'), { target: { value: STRONG } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Step 2 of 3');
    fireEvent.click(await screen.findByRole('radio', { name: /Authenticator app/ }, { timeout: 3000 }));

    const labelled = await screen.findByLabelText('Enter the 6-digit code from your app');
    expect(labelled).toBe(screen.getByLabelText('Six-digit authenticator code'));
  });

  it('an accepted code whose save fails still counts as enrolled, and Skip is no longer possible', async () => {
    const { c, storage } = await started();
    render(
      <VaultProvider controller={c}>
        <MemoryRouter>
          <CreateWizard
            onSuccess={() => undefined}
            onBackToUnlock={() => undefined}
            onStepChange={() => undefined}
            onVaultCreated={() => undefined}
            hasVault={false}
            onSwitchToUnlock={() => undefined}
          />
        </MemoryRouter>
      </VaultProvider>,
    );
    fireEvent.change(screen.getByLabelText('New master password'), { target: { value: STRONG } });
    fireEvent.change(screen.getByLabelText('Confirm master password'), { target: { value: STRONG } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Step 2 of 3');

    fireEvent.click(await screen.findByRole('radio', { name: /Authenticator app/ }, { timeout: 3000 }));
    fireEvent.click(await screen.findByText("Can't scan? Enter the secret manually"));
    const secret = (await screen.findByText((_, el) => el?.tagName === 'CODE')).textContent!.replace(/\s+/g, '');

    storage.failAllWrites = true; // the save of the new authenticator will fail
    fireEvent.change(screen.getByLabelText('Six-digit authenticator code'), {
      target: { value: (await getTotpCode(secret)).code },
    });

    await screen.findByText(/Authenticator enabled/);
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Confirm & continue' }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect((screen.getByRole('radio', { name: /Skip for now/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(c.getSnapshot().totpEnabled).toBe(true); // applied in memory, save retried
    expect(c.getSnapshot().save.state).toBe('error');
  });
});
