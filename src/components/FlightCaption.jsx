import { relationLabel } from '../data/graph.js';

/*
 * The search flyover's caption — each person on the path labelled by their
 * relation to the VIEWER (not to the previous hop), so a route through an
 * aunt and a cousin reads as "Mother → Grandmother → Half-Aunt → Half-Cousin"
 * rather than a flat chain of parent/child steps that wouldn't surface those
 * terms at all. The final crumb is the destination's actual name — the
 * payoff, since the profile no longer auto-opens on landing.
 *
 * Purely reactive to `upTo`, which the flyover's onSegment callback advances
 * in App.jsx as the camera passes each hop; the fade-in per crumb is CSS,
 * driven by the --visible class.
 */
export default function FlightCaption({ graph, order, upTo }) {
  if (!order || order.length < 2) return null;
  const originId = order[0];
  const target = graph.byId.get(order[order.length - 1]);
  const targetName = (target?.display_name || '').trim();

  // One relation-to-viewer label per hop after the origin (the origin itself
  // is implicitly "you" and isn't shown as a crumb).
  const relCrumbs = order.slice(1).map((id) => relationLabel(graph, originId, id));

  return (
    <div className="flight-caption" role="status" aria-live="polite">
      {relCrumbs.map((label, i) => (
        <span
          key={i}
          className={`flight-caption__crumb${i < upTo ? ' flight-caption__crumb--visible' : ''}`}
        >
          {i > 0 && <ArrowGlyph />}
          {label}
        </span>
      ))}
      {targetName && (
        <span
          className={`flight-caption__crumb flight-caption__crumb--name${upTo >= relCrumbs.length ? ' flight-caption__crumb--visible' : ''}`}
        >
          <ArrowGlyph />
          {targetName}
        </span>
      )}
    </div>
  );
}

function ArrowGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="flight-caption__arrow">
      <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
