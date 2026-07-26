import { useEffect, useState } from 'react';
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
 *
 * Swap toggle (feature request: read the same connection from either
 * person's perspective — "Matthew is Dianne's 2nd cousin's son" <-> "Dianne
 * is Matthew's mother's 2nd cousin"). relationLabel(graph, focusId, otherId)
 * is already a fully bidirectional "otherId's relationship TO focusId"
 * classifier — it's used everywhere else in the app for arbitrary person
 * pairs, not just anchor-to-viewer — so reading the SAME path from the
 * other end really is just reversing `order` before deriving start/end/
 * relation/crumbs from it; no separate relationship-inversion logic exists
 * or is needed. `reversed` resets to false whenever a genuinely new path is
 * traced, so a flipped view never survives onto an unrelated pair.
 */
export default function LineageBanner({ graph, anchorId, order, onClear, onExit, onPeek, onSearch }) {
  const kinTerms = useKinTerms();
  const anchor = graph.byId.get(anchorId);
  const first = (p) => (p?.display_name || '').trim().split(/\s+/)[0] || '';
  const hasPath = order && order.length >= 2;

  const [reversed, setReversed] = useState(false);
  useEffect(() => { setReversed(false); }, [order]);

  const displayOrder = hasPath ? (reversed ? [...order].reverse() : order) : null;
  const start = hasPath ? graph.byId.get(displayOrder[0]) : null;
  const end = hasPath ? graph.byId.get(displayOrder[displayOrder.length - 1]) : null;
  const relation = hasPath ? relationLabel(graph, displayOrder[0], displayOrder[displayOrder.length - 1], kinTerms) : null;
  const crumbs = hasPath ? buildRelationCrumbs(graph, displayOrder, kinTerms) : [];

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
            <span className="lineage-banner__connector">
              <span className="lineage-banner__count" aria-hidden="true">{displayOrder.length - 1}</span>
              <button
                type="button"
                className="lineage-banner__swap"
                onClick={() => setReversed((r) => !r)}
                aria-label="Swap — read this relationship from the other person's perspective"
              >
                <SwapGlyph />
              </button>
            </span>
            <span className="lineage-banner__node">
              <Avatar person={end} size={30} />
              <span className="lineage-banner__node-name">{first(end)}</span>
            </span>
          </div>
          <p className="lineage-banner__rel">
            {first(end)} is {first(start)}&apos;s <strong>{relation.toLowerCase()}</strong>
            <span className="lineage-banner__muted"> · {displayOrder.length} in this line</span>
          </p>
          {crumbs.length > 1 && (
            <div className="lineage-banner__breadcrumb">
              {crumbs.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  className="lineage-banner__crumb"
                  onClick={() => onPeek?.(displayOrder[c.toIndex])}
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

function SwapGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 8h13m0 0l-4-4m4 4l-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 16H5m0 0l4 4m-4-4l4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
