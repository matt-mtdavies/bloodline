import { useEffect, useState } from 'react';

// The tree screen's ambient, idle-only insight (nav brief: "give the tree
// screen a quiet version of Home's Did-you-know teaser"). Waits out a long
// settled pause in browse mode before appearing — comfortably longer than
// IntroHint's own 5.2s window, so the two quiet hints at the bottom of the
// screen never compete for the same moment — then stays up for VISIBLE_MS,
// dismissable early by a genuine tap. Unlike IntroHint (a one-shot onboarding
// nudge), this cycles through the whole fact pool across a browsing session —
// each dismissal/timeout re-arms for a different, not-yet-seen fact — rather
// than showing just one thing ever, so "keep looking" is actually rewarded
// with variety instead of going quiet after the first one.
const IDLE_MS = 8000;
// Feedback: 6s wasn't enough to read a full fact sentence before it vanished.
const VISIBLE_MS = 11000;
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

  // Arm: after a settled idle pause, show a fact this session hasn't shown
  // yet. Re-runs (and re-arms) every time `visible` flips back to false —
  // that's what turns "one fact ever" into "several across a session".
  useEffect(() => {
    if (!active || !facts?.length) return;
    const seen = loadSeen();
    const remaining = facts.filter((f) => !seen.has(f));
    if (!remaining.length) return; // every fact this tree currently supports has been shown
    const t = setTimeout(() => {
      const pick = remaining[Math.floor(Math.random() * remaining.length)];
      markSeen(pick);
      setFact(pick);
      setVisible(true);
    }, IDLE_MS);
    return () => clearTimeout(t);
  }, [active, facts, visible]);

  useEffect(() => {
    if (!visible) return;
    const hide = () => setVisible(false);
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
