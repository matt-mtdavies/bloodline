import { useEffect, useState } from 'react';
import { scheduleIdle, cancelIdle } from './idle.js';

/*
 * Defers an expensive derived value off the synchronous render path: `value`
 * starts (and stays) at `initial` until an idle callback fires and computes
 * the real result, then re-computes the same way whenever `deps` change.
 * Deliberately NOT a useMemo replacement everywhere — this trades "correct
 * on the very next paint" for "doesn't block that paint," which is only the
 * right trade for values nothing else's correctness depends on synchronously
 * (a duplicate-count pill, an ambient insight hint) — see the two Phase 1
 * call sites in App.jsx for the reasoning on why each one qualifies.
 */
export function useIdleValue(compute, deps, initial) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    let cancelled = false;
    const handle = scheduleIdle(() => {
      if (!cancelled) setValue(compute());
    });
    return () => { cancelled = true; cancelIdle(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
