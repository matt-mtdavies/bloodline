import { useEffect, useRef } from 'react';
import { lifespan } from '../lib/dates.js';

/*
 * The one name that matters: the focused person's, set in real type beneath
 * their centred bubble. It tracks the bubble live (the bubble drifts and the
 * camera glides), so it always sits with them. Everyone else stays a pure face
 * — tap to bring them to centre. This replaces the messy per-bubble canvas
 * labels with a single, gorgeous nameplate.
 */
export default function FocusNameplate({ person, getPos, hidden }) {
  const ref = useRef(null);

  useEffect(() => {
    let raf;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const p = !hidden && getPos ? getPos() : null;
        if (p) {
          el.style.transform = `translate(-50%, 0) translate(${p.x}px, ${p.y + 84}px)`;
          el.style.opacity = '1';
        } else {
          el.style.opacity = '0';
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getPos, hidden]);

  if (!person) return null;
  return (
    <div className="nameplate" ref={ref} aria-hidden="true">
      <span className="nameplate__pill" key={person.id}>
        <span className="nameplate__name">{person.display_name}</span>
        <span className="nameplate__dot">·</span>
        <span className="nameplate__dates">{lifespan(person)}</span>
      </span>
    </div>
  );
}
