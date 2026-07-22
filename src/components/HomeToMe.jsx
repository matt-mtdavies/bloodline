import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';

/*
 * "Back to you" — the map-style recenter control, borrowed wholesale from
 * the one gesture every phone user already knows: the locate-me button. It
 * shows the viewer's OWN portrait (faces are the product) ringed in the
 * accent, floating in the bottom-right thumb zone above the dock.
 *
 * It is deliberately CONTEXTUAL: mounted only while `visible` is true —
 * which App gates on "the tree isn't already framed on me" (activeId !==
 * myPersonId) and "no full-screen mode is running". When you're home, or
 * mid-lineage/time/recap, it isn't there at all, so the clean canvas costs
 * nothing when the control would be pointless.
 *
 * The very first time it appears, a quiet "Back to you" label rides
 * alongside for a few seconds, then never again (localStorage flag).
 */

const HINT_KEY = 'bloodline_hometome_hint_seen';
const HINT_MS = 4200;

export default function HomeToMe({ person, visible, onGoHome }) {
  const [mounted, setMounted] = useState(false); // in the DOM (for exit anim)
  const [shown, setShown] = useState(false); // the .is-in class (fade/slide)
  const [hint, setHint] = useState(false);
  const hintTimer = useRef(null);

  // Mount → next frame add .is-in (enter); unmount 240ms after .is-in leaves.
  useEffect(() => {
    if (visible) {
      setMounted(true);
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 240);
    return () => clearTimeout(t);
  }, [visible]);

  // First-ever appearance: ride a one-time "Back to you" label alongside.
  useEffect(() => {
    if (!shown) return;
    let seen = true;
    try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch { /* private mode */ }
    if (seen) return;
    setHint(true);
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* nothing to persist to */ }
    hintTimer.current = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(hintTimer.current);
  }, [shown]);

  if (!mounted || !person) return null;

  const firstName = (person.display_name || '').trim().split(/\s+/)[0] || 'you';

  return (
    <div className={`hometome${shown ? ' hometome--in' : ''}`}>
      {hint && <span className="hometome__hint">Back to you</span>}
      <button
        className="hometome__btn"
        onClick={() => { setHint(false); onGoHome(); }}
        aria-label={`Back to ${firstName} — recentre the tree on you`}
        title="Back to you"
      >
        <span className="hometome__ring" aria-hidden="true" />
        <Avatar person={person} size={48} />
        <span className="hometome__pin" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3.2" fill="currentColor" />
            <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="2" />
            <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
      </button>
    </div>
  );
}
