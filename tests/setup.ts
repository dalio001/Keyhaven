/**
 * Shared test setup. Tests run in Node by default (WebCrypto, BroadcastChannel,
 * structuredClone are built in); UI tests opt into jsdom with a
 * `// @vitest-environment jsdom` docblock.
 */
import { webcrypto } from 'node:crypto';
import { afterEach } from 'vitest';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
}
