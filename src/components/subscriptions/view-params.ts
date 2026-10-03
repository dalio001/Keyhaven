/**
 * Which view of /subscriptions the address asks for. The Overview is the
 * default; `?tab=subscriptions` and `?tab=accounts` pick the lists, and
 * `?account=<id>` an account page (it wins over `tab`). The drawer
 * parameters (`new`, `edit`, `preset`, `login`) work on top of any view.
 */

export type SubscriptionsView =
  | { kind: 'overview' }
  | { kind: 'subscriptions' }
  | { kind: 'accounts' }
  | { kind: 'account'; accountId: string };

export type SubscriptionsTab = 'overview' | 'subscriptions' | 'accounts';

export function parseView(params: URLSearchParams): SubscriptionsView {
  const account = params.get('account');
  if (account) return { kind: 'account', accountId: account };
  const tab = params.get('tab');
  if (tab === 'subscriptions' || tab === 'accounts') return { kind: tab };
  return { kind: 'overview' };
}

/** the tab shown as selected (an account page sits under Accounts) */
export function selectedTab(view: SubscriptionsView): SubscriptionsTab {
  return view.kind === 'account' ? 'accounts' : view.kind;
}
