import { useLayoutEffect, useState } from 'react';
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
 * `value` resets to `initial` the moment `deps` change, before the new idle
 * callback is even scheduled — it never keeps showing the value computed
 * for the PREVIOUS deps while a new one is pending. This is deliberately a
 * useLayoutEffect, not a useEffect (PR #86 review, round 2): a plain
 * useEffect runs AFTER the browser paints, so React would still commit and
 * paint one frame of "stale value, new deps" before the reset fires — a
 * real window where a destructive action (the Duplicates sheet's Merge
 * button, keyed off whatever `value` currently holds) could be taken
 * against a candidate an edit had already disqualified. useLayoutEffect's
 * setValue call is flushed synchronously, before that frame is ever
 * painted, so the stale value is never visible at all, not just cleared
 * quickly. The (cheap) reset is the only part that needs this — the
 * expensive `compute()` call still only ever runs inside the idle
 * callback, so this doesn't reintroduce the render-blocking cost the whole
 * hook exists to avoid.
 */
export function useIdleValue(compute, deps, initial) {
  const [value, setValue] = useState(initial);
  useLayoutEffect(() => {
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
