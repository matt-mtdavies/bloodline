import { useEffect, useState } from 'react';
import Logo from './Logo.jsx';

/*
 * "Back to the tree" — Time mode's missing exit. Lineage mode already has
 * a contextual "Done" button on its own banner (LineageBanner.jsx); Time
 * mode had nothing beyond re-tapping the same dock icon that turned it on
 * in the first place. Mirrors LineageBanner's own top, centred placement
 * so a full-canvas mode always has the same kind of quiet way out, and
 * carries the same breathing family mark used everywhere else this
 * session's "back to the tree" work touches — one recognizable gesture,
 * not a new one just for this mode.
 *
 * Same two-phase mount/animate approach as HomeToMe.jsx (mounted only
 * while `visible`, faded in a frame later, unmounted after its own exit
 * transition finishes) so it enters and leaves gently rather than
 * popping in and out.
 */
export default function ReturnToTreePill({ visible, onReturn }) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

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

  if (!mounted) return null;

  return (
    <button
      className={`return-pill${shown ? ' return-pill--in' : ''}`}
      onClick={onReturn}
      aria-label="Back to the tree"
    >
      <Logo size={18} idle animate={false} />
      Back to the tree
    </button>
  );
}
