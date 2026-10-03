/**
 * Links from other pages into the vault: `/vault?new=1`, `?edit=<id>`,
 * `?entry=<id>`, `?search=1`, `?filter=favorites`, `?cat=<category>` /
 * `?category=<category>`. The vault reads them once on arrival and then removes
 * them from the address. Secrets are never passed this way (see lib/handoff);
 * an old `?seed=` parameter is ignored and removed.
 */

import type { VaultCategory } from '@/lib/vault';
import { CATEGORY_ORDER } from './vault-utils';
import type { CategoryFilter } from './vault-utils';

export interface VaultLink {
  /** open this login's details */
  entryId: string | null;
  /** open the editor for this login */
  editId: string | null;
  /** open the new-login form */
  newLogin: boolean;
  /** open search */
  search: boolean;
  category: CategoryFilter | null;
}

export const VAULT_LINK_PARAMS = ['entry', 'edit', 'new', 'search', 'filter', 'cat', 'category', 'seed'] as const;

export function parseVaultLink(params: URLSearchParams): VaultLink {
  const cat = params.get('category') ?? params.get('cat');
  const category: CategoryFilter | null =
    params.get('filter') === 'favorites'
      ? 'favorites'
      : cat && (CATEGORY_ORDER as readonly string[]).includes(cat)
        ? (cat as VaultCategory)
        : null;
  return {
    entryId: params.get('entry'),
    editId: params.get('edit'),
    newLogin: params.get('new') === '1',
    search: params.get('search') === '1',
    category,
  };
}

/** true when the address carries any vault link parameter (to be removed) */
export function hasVaultLinkParams(params: URLSearchParams): boolean {
  return VAULT_LINK_PARAMS.some((k) => params.has(k));
}

/**
 * Where to go after unlocking: the vault link the locked vault redirected
 * from (carried in router state, so `?new=1` and friends survive the unlock),
 * or plain /vault. Only /vault links are accepted — never another page or site.
 */
export function vaultReturnPath(state: unknown): string {
  const next = typeof state === 'object' && state !== null ? (state as { next?: unknown }).next : undefined;
  return typeof next === 'string' && /^\/vault(\?[^#]*)?$/.test(next) ? next : '/vault';
}
