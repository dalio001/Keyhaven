// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useToday } from '@/hooks/useToday';

function Show() {
  return <p data-testid="today">{useToday()}</p>;
}

afterEach(() => vi.useRealTimers());

describe('useToday: the date rolls over at midnight even when nothing else re-renders', () => {
  it('re-checks the clock every 30 seconds', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date(2026, 9, 31, 23, 59, 50) });
    render(<Show />);
    expect(screen.getByTestId('today').textContent).toBe('2026-10-31');
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByTestId('today').textContent).toBe('2026-11-01');
  });

  it('re-checks when the tab comes back into view', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 2, 12, 0) });
    render(<Show />);
    vi.setSystemTime(new Date(2026, 9, 5, 9, 0));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByTestId('today').textContent).toBe('2026-10-05');
  });
});
