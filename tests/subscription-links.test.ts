import { describe, expect, it } from 'vitest';
import { displayHost, safeExternalUrl } from '@/components/subscriptions/links';

describe('links out of KeyHaven', () => {
  it('only http(s) addresses are opened; a bare host gets https', () => {
    expect(safeExternalUrl('chatgpt.com')).toBe('https://chatgpt.com/');
    expect(safeExternalUrl(' https://claude.ai/settings ')).toBe('https://claude.ai/settings');
    expect(safeExternalUrl('http://example.test')).toBe('http://example.test/');
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,hi', 'ftp://example.test', 'file:///etc/passwd', '', '   ', undefined, 'https://']) {
      expect(safeExternalUrl(bad), String(bad)).toBeNull();
    }
    expect(displayHost('https://www.chatgpt.com/')).toBe('chatgpt.com');
    // never an address carrying credentials
    expect(safeExternalUrl('https://admin:hunter2@nas.example/billing')).toBeNull();
    expect(safeExternalUrl('user@nas.example')).toBeNull();
  });
});
