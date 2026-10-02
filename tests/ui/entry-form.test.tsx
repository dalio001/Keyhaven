// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EntryFormDrawer from '@/components/vault/EntryFormDrawer';

describe('new-login form: two-factor code (KH-05)', () => {
  it('"+ Add two-factor code" reveals the secret field and puts the cursor in it', async () => {
    render(<EntryFormDrawer open mode="add" entry={null} onClose={() => undefined} onSave={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add two-factor code' }));
    const secret = await screen.findByLabelText('TOTP secret');
    await waitFor(() => expect(document.activeElement).toBe(secret));
    expect(screen.getByRole('button', { name: '− Hide two-factor code' })).toBeTruthy();
  });

  it('starts with a handed-over password in add mode (generator → Save to vault)', async () => {
    render(
      <EntryFormDrawer open mode="add" entry={null} initialPassword="Synthetic-Gen-Secret-42" onClose={() => undefined} onSave={() => undefined} />,
    );
    expect(((await screen.findByLabelText('Password')) as HTMLInputElement).value).toBe('Synthetic-Gen-Secret-42');
  });
});
