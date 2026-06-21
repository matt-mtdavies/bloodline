import { useEffect, useRef } from 'react';
import { lifespan, ageOrAt, yearOf } from '../lib/dates.js';

/*
 * The focused person's name, set in real type just ABOVE their bubble. It
 * tracks the bubble live (the bubble drifts and the camera glides), so it always
 * sits with them. Everyone else stays a pure face — tap to bring them in.
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
          // Anchor the pill's bottom snug above the bubble's top edge (BASE_RADIUS=46 + 6px gap).
          el.style.transform = `translate(${p.x}px, ${p.y - 52}px) translate(-50%, -100%)`;
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
        <span className="nameplate__meta">{metaLine(person)}</span>
      </span>
    </div>
  );
}

function metaLine(person) {
  if (person.is_deceased) {
    const aged = ageOrAt(person); // "aged 81"
    return [lifespan(person), aged].filter(Boolean).join(' · ');
  }
  const y = yearOf(person.birth_date);
  const age = ageOrAt(person); // "41"
  return [y && `b. ${y}`, age && `age ${age}`].filter(Boolean).join(' · ');
}
