import { describe, expect, it } from 'vitest';
import { parseVaultLink, vaultReturnPath } from '@/components/vault/deep-link';

describe('after unlocking, go back to the vault link (Codex review on #3)', () => {
  it('keeps a /vault link and its flags', () => {
    expect(vaultReturnPath({ next: '/vault?new=1' })).toBe('/vault?new=1');
    expect(vaultReturnPath({ next: '/vault?edit=nf-05' })).toBe('/vault?edit=nf-05');
    expect(vaultReturnPath({ next: '/vault' })).toBe('/vault');
    // Phase 4: links into Subscriptions (the Overview, an account page) survive unlocking too
    expect(vaultReturnPath({ next: '/subscriptions?account=a1&edit=s1' })).toBe('/subscriptions?account=a1&edit=s1');
    expect(vaultReturnPath({ next: '/subscriptions' })).toBe('/subscriptions');
    expect(parseVaultLink(new URLSearchParams(vaultReturnPath({ next: '/vault?new=1' }).split('?')[1])).newLogin).toBe(true);
  });

  it('anything else goes to plain /vault — never another page or site', () => {
    for (const next of ['//evil.example', 'https://evil.example/vault', '/settings', '/vaultx', '/vault/../settings', '/vault#x', '/vault?new=1#x', '/subscriptionsx', '/subscriptions#x', '/subscriptions/../settings', 42, null]) {
      expect(vaultReturnPath({ next })).toBe('/vault');
    }
    for (const state of [undefined, null, 'x', { welcome: 'unlock' }]) expect(vaultReturnPath(state)).toBe('/vault');
  });
});
