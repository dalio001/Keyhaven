import { describe, expect, it } from 'vitest';
import { parseView, selectedTab } from '@/components/subscriptions/view-params';

const view = (q: string) => parseView(new URLSearchParams(q));

describe('which view of /subscriptions the address asks for', () => {
  it('Overview by default; tabs by name; an account page wins over tab', () => {
    expect(view('')).toEqual({ kind: 'overview' });
    expect(view('tab=subscriptions')).toEqual({ kind: 'subscriptions' });
    expect(view('tab=accounts')).toEqual({ kind: 'accounts' });
    expect(view('tab=nonsense')).toEqual({ kind: 'overview' });
    expect(view('tab=subscriptions&account=a1')).toEqual({ kind: 'account', accountId: 'a1' });
    expect(view('edit=s1')).toEqual({ kind: 'overview' }); // drawers work on top of any view
  });

  it('an account page shows the Accounts tab as selected', () => {
    expect(selectedTab({ kind: 'account', accountId: 'a1' })).toBe('accounts');
    expect(selectedTab({ kind: 'overview' })).toBe('overview');
  });
});
