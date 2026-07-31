import { useEffect, useState } from 'react';
import { scheduleIdle, cancelIdle } from './idle.js';

/*
 * Defers an expensive derived value off the synchronous render path: `value`
 * starts at `initial` until an idle callback fires and computes the real
 * result, then re-computes the same way whenever `deps` change. Deliberately
 * NOT a useMemo replacement everywhere — this trades "correct on the very
 * next paint" for "doesn't block that paint," which is only the right trade
 * for values nothing else's correctness depends on synchronously (a
 * duplicate-count pill, an ambient insight hint) — see the two Phase 1 call
 * sites in App.jsx for the reasoning on why each one qualifies.
 *
 * `value` resets to `initial` SYNCHRONOUSLY the moment `deps` change, before
 * the new idle callback is even scheduled — it never keeps showing the
 * value computed for the PREVIOUS deps while a new one is pending (PR #86
 * review: for duplicatePairs specifically, a stale candidate briefly
 * surviving the exact edit that resolved it is a real risk, not just
 * cosmetic staleness, since the Duplicates sheet's Merge button is a
 * destructive action keyed off whatever `value` currently holds).
 */
export function useIdleValue(compute, deps, initial) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    let cancelled = false;
    setValue(initial);
    const handle = scheduleIdle(() => {
      if (!cancelled) setValue(compute());
    });
    return () => { cancelled = true; cancelIdle(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
