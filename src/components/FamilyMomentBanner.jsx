import { useEffect, useRef, useState } from 'react';
import { dayIndex } from '../lib/insightModules.js';

/*
 * "Family Moments" — the always-on-open banner (docs/FAMILY-MOMENTS.md
 * slice 5). App.jsx already did the hard part: fetched geocoding/last-
 * viewed data, computed `moments` via pickTodaysFamilyMoment, and decided
 * `visible` (browse mode, nothing else open). This component owns its own
 * entrance/exit animation, the odometer roll between multiple same-day
 * moments, and the "shown once per day" bookkeeping — same two-phase mount
 * pattern as HomeToMe.jsx/ReturnToTreePill.jsx, so it enters and leaves as
 * gently as everything else that floats over the canvas.
 *
 * Deliberately does NOT replace the Home hub's existing "Did you know?"
 * card — that stays exactly as it is. This is a new, separate surface, and
 * (see pickTodaysFamilyMoment's own header comment) it's ALSO deliberately
 * narrower than that card: this only ever shows a real today-birthday or
 * today-anniversary, never a generic tree-wide fact. On a day with neither,
 * `moments` is null and this renders nothing at all.
 *
 * `onShown` (slice 6) fires once per moment actually shown on screen (not
 * once per banner visit) — App.jsx uses it to log silent engagement
 * instrumentation (functions/api/moment-engagement.js) per birthday/
 * anniversary, since each is its own distinct thing worth its own signal.
 *
 * Real user feedback on the first cut: too wide/tall, sat too high (clashing
 * with the topbar's own family-stats pill), and stuck around indefinitely.
 * Fixed with three changes: (1) CSS moved it below the topbar's two rows,
 * matching the same `top: 96px` spot .return-pill/.lineage-banner already
 * use for "float just under the topbar"; (2) collapsed to one slim line —
 * greeting and moment merged into a single string; (3) auto-dismisses
 * itself once every today-moment has had its turn, same hide path a manual
 * tap-to-dismiss uses, so it reads as a passing toast rather than a fixture
 * nobody asked for.
 *
 * Second round of real feedback: (a) that single line was truncated with an
 * ellipsis — "It's Keira's birthday today — turning 32" got clipped before
 * the sentence finished; the line no longer truncates at all, it just wraps
 * (see the CSS: no more white-space/text-overflow, and the outer pill's
 * border-radius came down from a full stadium shape so a two-line message
 * doesn't look like it's fighting its own container). (b) a day with more
 * than one birthday only ever showed the first — pickTodaysFamilyMoment now
 * returns every today-moment, and this component rolls through the whole
 * list, odometer-style (old line slides up and out, next slides up into
 * place from below), holding each on screen for ITEM_DWELL_MS before rolling
 * to the next; once the LAST one's dwell completes, the banner dismisses
 * for the day exactly like the old fixed-duration auto-hide did. (c) the
 * generic-fact fallback that used to appear in this same slot on quiet days
 * is gone — see pickTodaysFamilyMoment, which no longer produces one.
 */

const DISMISS_KEY = 'bl_family_moment_dismissed_day';
// How long each individual moment stays on screen before rolling to the
// next (or, if it's the last, before the whole banner dismisses) — replaces
// the old single fixed AUTO_HIDE_MS now that there can be more than one
// moment to get through in a single visit.
const ITEM_DWELL_MS = 8000;
// Duration of the odometer roll transition between two moments.
const ROLL_MS = 380;

export function isDismissedToday(now = Date.now()) {
  try { return Number(localStorage.getItem(DISMISS_KEY)) === dayIndex(now); }
  catch { return false; }
}

export function markDismissedToday(now = Date.now()) {
  try { localStorage.setItem(DISMISS_KEY, String(dayIndex(now))); }
  catch { /* private mode / quota — worst case it can show again this session */ }
}

export function greetingForHour(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function FamilyMomentBanner({ moments, firstName, visible, onOpen, onDismiss, onShown }) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  // Tracks a dismiss THIS render session — isDismissedToday() alone reads
  // localStorage, which markDismissedToday() below writes to but which
  // never itself triggers a re-render, so the click would otherwise write
  // the flag correctly but the banner would stay on screen until something
  // else happened to re-render this component.
  const [dismissedNow, setDismissedNow] = useState(false);
  // Which moment in the list is currently on screen, and where the roll
  // transition is: 'idle' (resting, wraps freely, no absolute positioning),
  // 'armed' (both old/next lines placed at their STARTING position with no
  // transition, one frame before the animation begins — the same
  // snap-then-flip trick `shown` itself uses below), or 'moving' (both
  // lines animating toward their final position).
  const [index, setIndex] = useState(0);
  const [rollPhase, setRollPhase] = useState('idle');
  const [rollHeight, setRollHeight] = useState(null);
  const lineRef = useRef(null);

  // Reset the local dismiss flag on a new day — otherwise a dismiss from
  // yesterday (this component instance still mounted, e.g. the tab was
  // left open overnight) would suppress a genuinely new moment today.
  const todayIndex = dayIndex(Date.now());
  useEffect(() => { setDismissedNow(false); }, [todayIndex]);

  const actuallyVisible = visible && !!moments?.length && !dismissedNow && !isDismissedToday();

  // A new moments list (a new day, or the underlying tree data changed)
  // always starts the roll over from the top.
  useEffect(() => { setIndex(0); setRollPhase('idle'); }, [moments]);

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

  const current = moments?.[index] ?? null;

  // Fires once per moment actually displayed (not once per banner visit) —
  // see the header comment.
  useEffect(() => {
    if (shown && current?.key) onShown?.(current.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, current?.key]);

  // The dwell/roll/dismiss clock. Each moment gets ITEM_DWELL_MS; if it's
  // not the last one, that's followed by a brief roll to the next; if it IS
  // the last one, the banner dismisses for the day instead — the exact same
  // "hide and remember" path a manual tap on × takes, just timer-fired.
  useEffect(() => {
    if (!shown || !moments?.length) return;
    const isLast = index >= moments.length - 1;
    const dwellTimer = setTimeout(() => {
      if (isLast) {
        markDismissedToday();
        setDismissedNow(true);
        onDismiss?.();
        return;
      }
      // Measure the currently-resting line so the roll has a stable pixel
      // height to animate within — the two lines can differ in wrapped
      // height (a longer name, a two-line message), and translateY(±100%)
      // is relative to each line's OWN box, so this only needs to size the
      // container, not match the two lines to each other.
      setRollHeight(lineRef.current?.getBoundingClientRect().height ?? null);
      setRollPhase('armed');
    }, ITEM_DWELL_MS);
    return () => clearTimeout(dwellTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, index, moments]);

  // 'armed' → 'moving': the same double-rAF-free snap-then-flip pattern as
  // the mount/shown effect above, just for the roll instead of the entrance.
  useEffect(() => {
    if (rollPhase !== 'armed') return;
    const r = requestAnimationFrame(() => setRollPhase('moving'));
    return () => cancelAnimationFrame(r);
  }, [rollPhase]);

  // 'moving' → advance to the next moment and settle back to 'idle'.
  useEffect(() => {
    if (rollPhase !== 'moving') return;
    const t = setTimeout(() => {
      setIndex((i) => i + 1);
      setRollPhase('idle');
    }, ROLL_MS);
    return () => clearTimeout(t);
  }, [rollPhase]);

  if (!mounted || !current) return null;

  const greeting = greetingForHour(new Date().getHours());
  const textFor = (m) => (firstName ? `${greeting}, ${firstName} — ${m.text}` : `${greeting} — ${m.text}`);
  const rolling = rollPhase !== 'idle';
  const next = rolling ? moments[(index + 1) % moments.length] : null;

  return (
    <div className={`family-moment${shown ? ' family-moment--in' : ''}`} role="status">
      <button
        type="button"
        className="family-moment__body"
        onClick={() => { markDismissedToday(); setDismissedNow(true); onOpen?.(current); }}
      >
        <span className="family-moment__ico" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 18 18" fill="none">
            <path d="M9 2.5c.6 1.6 1.9 2.9 3.5 3.5-1.6.6-2.9 1.9-3.5 3.5-.6-1.6-1.9-2.9-3.5-3.5C7.1 5.4 8.4 4.1 9 2.5Z" fill="currentColor" />
            <path d="M14.5 10c.35.95 1.1 1.7 2 2-1 .35-1.65 1.05-2 2-.35-.95-1.05-1.65-2-2 .95-.3 1.65-1.05 2-2Z" fill="currentColor" />
          </svg>
        </span>
        {rolling ? (
          <span className="family-moment__line-wrap" style={{ height: rollHeight ?? undefined }}>
            <span
              className={`family-moment__line family-moment__line--outgoing${rollPhase === 'moving' ? ' family-moment__line--animating' : ''}`}
            >
              {textFor(current)}
            </span>
            <span
              className={`family-moment__line family-moment__line--incoming${rollPhase === 'moving' ? ' family-moment__line--animating' : ''}`}
            >
              {textFor(next)}
            </span>
          </span>
        ) : (
          <span className="family-moment__line" ref={lineRef}>{textFor(current)}</span>
        )}
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
