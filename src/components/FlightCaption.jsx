import { useEffect, useState } from 'react';
import Avatar from './Avatar.jsx';
import { relationLabel } from '../data/graph.js';

/*
 * The search flyover's payoff. Two phases:
 *
 *  - Transit: a breadcrumb trail lights up hop by hop as the camera passes
 *    each relative (driven by `upTo`, advanced from App.jsx's onSegment) —
 *    unchanged from before.
 *  - Landed: once the camera settles, this replaces itself with a two-photo
 *    relationship card — the same visual language as the Lineage banner
 *    (avatar · hop-count badge · avatar, a plain-English relation line) —
 *    with the full crumb trail hidden by default behind the hop-count
 *    badge (tap to reveal). Auto-dismisses 15s after landing if left
 *    untouched; the moment the chain is expanded that timer is cancelled
 *    for good, and it stays up until "Done" is tapped.
 */
export default function FlightCaption({ graph, order, upTo, landed, onDone }) {
  const [chainOpen, setChainOpen] = useState(false);

  useEffect(() => {
    if (!landed || chainOpen) return;
    const t = setTimeout(() => onDone?.(), 15000);
    return () => clearTimeout(t);
  }, [landed, chainOpen, onDone]);

  if (!order || order.length < 2) return null;
  const originId = order[0];
  const origin = graph.byId.get(originId);
  const target = graph.byId.get(order[order.length - 1]);
  const targetName = (target?.display_name || '').trim();
  const first = (p) => (p?.display_name || '').trim().split(/\s+/)[0] || '';

  // One relation-to-viewer label per hop after the origin (the origin itself
  // is implicitly "you" and isn't shown as a crumb).
  const relCrumbs = order.slice(1).map((id) => relationLabel(graph, originId, id));

  if (landed) {
    const relation = relationLabel(graph, originId, order[order.length - 1]);
    return (
      <div className="flight-result" role="status" aria-live="polite">
        <div className="flight-result__chain">
          <span className="flight-result__node">
            <Avatar person={origin} size={30} />
            <span className="flight-result__node-name">{first(origin)}</span>
          </span>
          <button
            className="flight-result__connector"
            onClick={() => setChainOpen((v) => !v)}
            aria-label="Show the full relationship chain"
            aria-expanded={chainOpen}
          >
            <span className="flight-result__count">{order.length - 1}</span>
          </button>
          <span className="flight-result__node">
            <Avatar person={target} size={30} />
            <span className="flight-result__node-name">{first(target)}</span>
          </span>
        </div>
        <p className="flight-result__rel">
          {targetName} is {first(origin)}&apos;s <strong>{relation.toLowerCase()}</strong>
        </p>
        {chainOpen && (
          <div className="flight-result__breadcrumb">
            {relCrumbs.map((label, i) => (
              <span key={i} className="flight-result__crumb">
                {i > 0 && <ArrowGlyph />}
                {label}
              </span>
            ))}
          </div>
        )}
        <button className="flight-result__done" onClick={() => onDone?.()}>Done</button>
      </div>
    );
  }

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
