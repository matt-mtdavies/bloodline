import { relationLabel } from '../data/graph.js';

/*
 * The search flyover's caption — a relationship chain that fills in hop by
 * hop as the camera passes each person ("James → Father → Grandfather"),
 * tying the visual trace to language. Purely reactive to `upTo`, which the
 * flyover's onSegment callback advances in App.jsx as the camera lands on
 * each hop; the fade-in per crumb is CSS, driven by the --visible class.
 */
export default function FlightCaption({ graph, order, upTo }) {
  if (!order || order.length < 2) return null;
  const start = graph.byId.get(order[0]);
  const firstName = (start?.display_name || '').trim().split(/\s+/)[0] || 'Start';
  const hops = [];
  for (let i = 1; i < order.length; i++) {
    hops.push(relationLabel(graph, order[i - 1], order[i]));
  }

  return (
    <div className="flight-caption" role="status" aria-live="polite">
      <span className="flight-caption__crumb flight-caption__crumb--visible">{firstName}</span>
      {hops.map((label, i) => (
        <span
          key={i}
          className={`flight-caption__crumb${i <= upTo - 1 ? ' flight-caption__crumb--visible' : ''}`}
        >
          <ArrowGlyph />
          {label}
        </span>
      ))}
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
