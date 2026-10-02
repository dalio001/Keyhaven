/**
 * Services offered as one-click choices in the subscription form. Names,
 * websites and a category only: prices and plans change, so they are always
 * entered by the user — nothing here is fetched or assumed.
 */

import type { VaultCategory } from './vault';

export interface ServicePreset {
  key: string;
  name: string;
  website: string;
  category: VaultCategory;
}

export const SERVICE_PRESETS: readonly ServicePreset[] = [
  { key: 'claude', name: 'Claude', website: 'https://claude.ai', category: 'work' },
  { key: 'chatgpt', name: 'ChatGPT', website: 'https://chatgpt.com', category: 'work' },
  { key: 'gemini', name: 'Gemini', website: 'https://gemini.google.com', category: 'work' },
  { key: 'wispr-flow', name: 'Wispr Flow', website: 'https://wisprflow.ai', category: 'work' },
];

export function findPreset(key: string | undefined): ServicePreset | undefined {
  return key ? SERVICE_PRESETS.find((p) => p.key === key) : undefined;
}
