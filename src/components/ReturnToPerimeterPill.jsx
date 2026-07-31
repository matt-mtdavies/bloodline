import { useEffect, useState } from 'react';
import Logo from './Logo.jsx';

/*
 * "Return to my perimeter" (docs/FAMILY-PERIMETER-AND-5000-PERSON-
 * PERFORMANCE.md §3.8) — the exit for a temporary reveal (reached via
 * Search or a boundary's "Explore this branch"). Modeled directly on
 * ReturnToTreePill.jsx: same top-centred placement, same breathing family
 * mark, same two-phase mount/animate so it enters and leaves gently rather
 * than popping in and out.
 */
export default function ReturnToPerimeterPill({ visible, onReturn }) {
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
      aria-label="Return to my perimeter"
    >
      <Logo size={18} idle animate={false} />
      Return to my perimeter
    </button>
  );
}
