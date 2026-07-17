import Avatar from './Avatar.jsx';
import { relationLabel, buildRelationCrumbs } from '../data/graph.js';
import { useKinTerms } from '../lib/kinTerms.js';

/*
 * Lineage Mode banner — floats below the masthead while you trace a family
 * line. Empty state guides you ("tap another relative"); once a path is set it
 * shows the two ends with their faces, the relationship between them, and the
 * length of the line. Slides in with a soft motion.
 *
 * Below the headline relation, the same possessive breadcrumb chain the
 * search flyover shows ("Father's Brother's Daughter") — built once with
 * buildRelationCrumbs (shared with FlightCaption) rather than leaving the
 * headline as the only explanation of how the two people actually connect.
 * Always shown in full (no build-up/collapse to animate — the whole line is
 * already drawn on the tree the moment a path exists); each crumb is
 * tappable, same as in search, to pulse that person's bubble.
 */
export default function LineageBanner({ graph, anchorId, order, onClear, onExit, onPeek, onSearch }) {
  const kinTerms = useKinTerms();
  const anchor = graph.byId.get(anchorId);
  const first = (p) => (p?.display_name || '').trim().split(/\s+/)[0] || '';
  const hasPath = order && order.length >= 2;
  const start = hasPath ? graph.byId.get(order[0]) : null;
  const end = hasPath ? graph.byId.get(order[order.length - 1]) : null;
  const relation = hasPath ? relationLabel(graph, order[0], order[order.length - 1], kinTerms) : null;
  const crumbs = hasPath ? buildRelationCrumbs(graph, order, kinTerms) : [];

  return (
    <div className="lineage-banner" role="status" aria-live="polite">
      {!hasPath ? (
        <div className="lineage-banner__guide">
          <span className="lineage-banner__glyph"><LineageGlyph /></span>
          <p className="lineage-banner__text">
            Tracing from <strong>{anchor ? first(anchor) : 'someone'}</strong> — tap another relative, or search, to draw the line.
          </p>
          {onSearch && (
            <button className="lineage-banner__search" onClick={onSearch} aria-label="Search for who to trace to">
              <SearchGlyph />
            </button>
          )}
          <button className="lineage-banner__exit" onClick={onExit}>Done</button>
        </div>
      ) : (
        <div className="lineage-banner__result">
          <div className="lineage-banner__chain">
            <span className="lineage-banner__node">
              <Avatar person={start} size={30} />
              <span className="lineage-banner__node-name">{first(start)}</span>
            </span>
            <span className="lineage-banner__connector" aria-hidden="true">
              <span className="lineage-banner__count">{order.length - 1}</span>
            </span>
            <span className="lineage-banner__node">
              <Avatar person={end} size={30} />
              <span className="lineage-banner__node-name">{first(end)}</span>
            </span>
          </div>
          <p className="lineage-banner__rel">
            {first(end)} is {first(start)}&apos;s <strong>{relation.toLowerCase()}</strong>
            <span className="lineage-banner__muted"> · {order.length} in this line</span>
          </p>
          {crumbs.length > 1 && (
            <div className="lineage-banner__breadcrumb">
              {crumbs.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  className="lineage-banner__crumb"
                  onClick={() => onPeek?.(order[c.toIndex])}
                >
                  {c.label}{i < crumbs.length - 1 ? "'s" : ''}
                </button>
              ))}
            </div>
          )}
          <div className="lineage-banner__actions">
            <button className="lineage-banner__clear" onClick={onClear}>Clear</button>
            <button className="lineage-banner__exit" onClick={onExit}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LineageGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6" cy="18" r="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 7l8 4M8 17l8-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
