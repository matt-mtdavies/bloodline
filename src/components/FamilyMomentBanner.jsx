import { useEffect, useState } from 'react';
import { dayIndex } from '../lib/insightModules.js';

/*
 * "Family Moments" — the always-on-open banner (docs/FAMILY-MOMENTS.md
 * slice 5). App.jsx already did the hard part: fetched geocoding/last-
 * viewed data, computed `moment` via pickTodaysFamilyMoment, and decided
 * `visible` (browse mode, nothing else open). This component owns only its
 * own entrance/exit animation and the "shown once per day" bookkeeping —
 * same two-phase mount pattern as HomeToMe.jsx/ReturnToTreePill.jsx, so it
 * enters and leaves as gently as everything else that floats over the
 * canvas.
 *
 * Deliberately does NOT replace the Home hub's existing "Did you know?"
 * card — that stays exactly as it is. This is a new, separate surface.
 *
 * `onShown` (slice 6) fires once, the moment this banner actually renders
 * on screen — App.jsx uses it to log silent engagement instrumentation
 * (functions/api/moment-engagement.js). This component has no idea that's
 * happening; it just reports "this was shown" the same way it already
 * reported it to recordShownMomentKey's own local freshness bookkeeping.
 */

const DISMISS_KEY = 'bl_family_moment_dismissed_day';
const RECENT_KEYS_KEY = 'bl_family_moment_recent_keys';
const RECENT_WINDOW_DAYS = 7;

export function isDismissedToday(now = Date.now()) {
  try { return Number(localStorage.getItem(DISMISS_KEY)) === dayIndex(now); }
  catch { return false; }
}

export function markDismissedToday(now = Date.now()) {
  try { localStorage.setItem(DISMISS_KEY, String(dayIndex(now))); }
  catch { /* private mode / quota — worst case it can show again this session */ }
}

// The freshness half of the scoring engine (rankCandidates' recentKeys) —
// read BEFORE picking today's moment, in App.jsx, so this needs to be
// callable from there too, not just internally on dismiss.
export function loadRecentMomentKeys(now = Date.now()) {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEYS_KEY) || '[]');
    const cutoff = dayIndex(now) - RECENT_WINDOW_DAYS;
    return new Set(arr.filter((e) => e.day >= cutoff).map((e) => e.key));
  } catch { return new Set(); }
}

export function recordShownMomentKey(key, now = Date.now()) {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEYS_KEY) || '[]');
    const cutoff = dayIndex(now) - RECENT_WINDOW_DAYS;
    const fresh = arr.filter((e) => e.day >= cutoff);
    fresh.push({ key, day: dayIndex(now) });
    localStorage.setItem(RECENT_KEYS_KEY, JSON.stringify(fresh));
  } catch { /* private mode / quota */ }
}

export function greetingForHour(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function FamilyMomentBanner({ moment, firstName, visible, onOpen, onDismiss, onShown }) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  // Tracks a dismiss THIS render session — isDismissedToday() alone reads
  // localStorage, which markDismissedToday() below writes to but which
  // never itself triggers a re-render, so the click would otherwise write
  // the flag correctly but the banner would stay on screen until something
  // else happened to re-render this component.
  const [dismissedNow, setDismissedNow] = useState(false);

  // Reset the local dismiss flag on a new day — otherwise a dismiss from
  // yesterday (this component instance still mounted, e.g. the tab was
  // left open overnight) would suppress a genuinely new moment today.
  const todayIndex = dayIndex(Date.now());
  useEffect(() => { setDismissedNow(false); }, [todayIndex]);

  const actuallyVisible = visible && !!moment && !dismissedNow && !isDismissedToday();

  useEffect(() => {
    if (actuallyVisible) {
      setMounted(true);
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 240);
    return () => clearTimeout(t);
  }, [actuallyVisible]);

  // Records this moment's category as "recently shown" the moment it's
  // actually displayed (not just computed) — so tomorrow's freshness
  // scoring sees it, and a moment that never rendered (e.g. the app never
  // reached browse mode today) doesn't get penalized for a showing that
  // never happened.
  useEffect(() => {
    if (shown && moment?.key) {
      recordShownMomentKey(moment.key);
      onShown?.(moment.key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, moment?.key]);

  if (!mounted || !moment) return null;

  const greeting = greetingForHour(new Date().getHours());

  return (
    <div className={`family-moment${shown ? ' family-moment--in' : ''}`} role="status">
      <button
        type="button"
        className="family-moment__body"
        onClick={() => { markDismissedToday(); setDismissedNow(true); onOpen?.(); }}
      >
        <span className="family-moment__ico" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 2.5c.6 1.6 1.9 2.9 3.5 3.5-1.6.6-2.9 1.9-3.5 3.5-.6-1.6-1.9-2.9-3.5-3.5C7.1 5.4 8.4 4.1 9 2.5Z" fill="currentColor" />
            <path d="M14.5 10c.35.95 1.1 1.7 2 2-1 .35-1.65 1.05-2 2-.35-.95-1.05-1.65-2-2 .95-.3 1.65-1.05 2-2Z" fill="currentColor" />
          </svg>
        </span>
        <span className="family-moment__text">
          <span className="family-moment__greeting">{firstName ? `${greeting}, ${firstName}` : greeting}</span>
          <span className="family-moment__moment">{moment.text}</span>
        </span>
      </button>
      <button
        type="button"
        className="family-moment__dismiss"
        aria-label="Dismiss"
        onClick={() => { markDismissedToday(); setDismissedNow(true); onDismiss?.(); }}
      >
        ×
      </button>
    </div>
  );
}
