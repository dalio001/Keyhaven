import { useEffect, useState } from 'react';
import { todayLocal } from '@/lib/billing/dates';
import type { CalendarDate } from '@/lib/vault';

const RECHECK_MS = 30_000;

/**
 * Today's local calendar day. Re-checked every 30 s and whenever the tab
 * comes back, so dates roll over at midnight even when nothing else
 * re-renders (auto-lock off). Setting the same day again doesn't re-render.
 */
export function useToday(): CalendarDate {
  const [today, setToday] = useState(() => todayLocal(new Date()));
  useEffect(() => {
    const check = () => setToday(todayLocal(new Date()));
    const timer = window.setInterval(check, RECHECK_MS);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  return today;
}

/** the current time, refreshed every minute and when the tab comes back (for time-based UI like the backup reminder) */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [intervalMs]);
  return now;
}
