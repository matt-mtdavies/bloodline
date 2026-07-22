import { useEffect, useRef, useState } from 'react';

// The tree screen's ambient, idle-only insight (nav brief: "give the tree
// screen a quiet version of Home's Did-you-know teaser"). Waits out a
// GENUINE settled pause in browse mode before appearing, then stays up for
// VISIBLE_MS, dismissable early by a real tap. Cycles through the whole
// fact pool across a browsing session — each dismissal/timeout re-arms for
// a different, not-yet-seen fact — rather than showing just one thing ever.
//
// Rewritten after a real user report ("they are popping up every 3-4
// seconds and scrolling through mid pop-up... it looks odd"), which turned
// out to be two real bugs, not a perception issue:
//   1. The old arm effect rescheduled a NEW fact IDLE_MS after a hint first
//      appeared — but IDLE_MS was shorter than VISIBLE_MS, so partway
//      through every hint's own display window it silently swapped the
//      text for a different fact, with no re-entrance animation (same DOM
//      node). It looked exactly like the hint was cycling on its own.
//   2. Despite the name, the idle timer was armed the instant browse mode
//      was entered and never reset on real activity — panning, zooming and
//      dragging never touched it — so it fired on a fixed clock whether or
//      not you were actually mid-scroll, rather than only once you'd
//      genuinely stopped.
// Fixed here: the arm effect never reschedules while a fact is already
// visible; the idle wait resets on real pointer/wheel activity so it only
// ever fires after true stillness; and a cooldown after each hint hides
// keeps the next one from arming again immediately.
const IDLE_MS = 14000; // genuine stillness required before a fact appears
// Feedback: 6s wasn't enough to read a full fact sentence before it vanished.
const VISIBLE_MS = 11000;
// Minimum gap after one hint hides before the next is allowed to arm, so
// facts read as an occasional aside rather than a metronome.
const COOLDOWN_MS = 20000;
// A pan/zoom/drag on the canvas begins with the exact same pointerdown that
// bubbles up to window — without this, the first touch of ANY gesture (not
// just a deliberate dismiss tap) hid the hint mid-sentence, cutting off the
// full VISIBLE_MS a scrolling/panning user was always entitled to. A real
// dismiss-tap has essentially zero movement between down and up; a pan does
// not, so movement is what tells the two apart.
const TAP_SLOP_PX = 8;

const SEEN_KEY = 'bl_idle_facts_seen';
function loadSeen() {
  try { return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function markSeen(fact) {
  try {
    const seen = loadSeen();
    seen.add(fact);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch { /* private mode / quota — the in-memory session still won't repeat */ }
}

export default function IdleFactHint({ facts, active }) {
  const [fact, setFact] = useState(null);
  const [visible, setVisible] = useState(false);
  // Survives across arm-effect re-runs (unlike a plain variable), and
  // deliberately does NOT live in React state — it's read only inside the
  // timer scheduling below, so a state-driven re-render would be wasted.
  const cooldownUntilRef = useRef(0);

  // Arm: while active with no fact currently visible, wait for a real
  // settled pause — re-armed from scratch on every genuine pointer/wheel
  // activity — before showing a fact this session hasn't shown yet. The
  // `visible` guard is what stops the old double-schedule bug: this effect
  // never schedules a new reveal while one is already on screen.
  useEffect(() => {
    if (!active || !facts?.length || visible) return;
    const seen = loadSeen();
    const remaining = facts.filter((f) => !seen.has(f));
    if (!remaining.length) return; // every fact this tree currently supports has been shown

    let t = null;
    const arm = () => {
      clearTimeout(t);
      const wait = Math.max(IDLE_MS, cooldownUntilRef.current - Date.now());
      t = setTimeout(() => {
        const pick = remaining[Math.floor(Math.random() * remaining.length)];
        markSeen(pick);
        setFact(pick);
        setVisible(true);
      }, wait);
    };
    arm();

    window.addEventListener('pointerdown', arm);
    window.addEventListener('pointermove', arm, { passive: true });
    window.addEventListener('wheel', arm, { passive: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('pointermove', arm);
      window.removeEventListener('wheel', arm);
    };
  }, [active, facts, visible]);

  useEffect(() => {
    if (!visible) return;
    const hide = () => {
      setVisible(false);
      cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
    };
    const t = setTimeout(hide, VISIBLE_MS);
    let downPos = null;
    const onDown = (e) => { downPos = { x: e.clientX, y: e.clientY }; };
    const onUp = (e) => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (moved < TAP_SLOP_PX) hide(); // a real tap-to-dismiss, not a pan/drag/pinch
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, [visible]);

  if (!visible || !fact) return null;
  return (
    <div className="intro-hint intro-hint--fact" role="status">
      <span className="intro-hint__spark" aria-hidden="true">✨</span>
      {fact}
    </div>
  );
}
