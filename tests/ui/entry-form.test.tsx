// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import EntryFormDrawer from '@/components/vault/EntryFormDrawer';

describe('new-login form', () => {
  it('starts with a handed-over password in add mode (generator → Save to vault)', async () => {
    render(
      <EntryFormDrawer open mode="add" entry={null} initialPassword="Synthetic-Gen-Secret-42" onClose={() => undefined} onSave={() => undefined} />,
    );
    expect(((await screen.findByLabelText('Password')) as HTMLInputElement).value).toBe('Synthetic-Gen-Secret-42');
  });
});
