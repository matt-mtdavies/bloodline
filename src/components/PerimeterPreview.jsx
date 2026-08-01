import { useState, useMemo, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Avatar from './Avatar.jsx';
import ReturnMark from './ReturnMark.jsx';
import { lifespan } from '../lib/dates.js';
import { computePerspectiveIndex } from '../lib/perspectiveIndex.js';
import { PERIMETER_OPTIONS, engineLevelFor } from '../lib/familyPerimeter.js';

// Matches AccessibleTree.jsx's DIRECTORY_ROW_HEIGHT convention — a
// person-row is 62px + a 6px gap, baked into the fixed stride the
// virtualizer positions rows at.
const ROW_HEIGHT = 68;
const HEADER_HEIGHT = 40;

// Friendly labels for each inclusion tier (perspectiveIndex.js's own
// TIER_RANK order) — every person in perimeterIds carries a canonical
// inclusionReasonById entry with one of these three tiers (temporaryReveal
// never appears in a SAVED perimeter, only in a session-only exploration).
const TIER_LABELS = {
  primary: 'Direct family & cousins',
  familyHalo: 'Family halo — connected through marriage',
  partnerContext: "Your partner's own family",
};
const TIER_ORDER = ['primary', 'familyHalo', 'partnerContext'];

// Ring radii, largest (Everyone) last so it paints first/furthest back —
// deliberately fixed proportions, not data-proportional: a real family can
// have "Close family" resolve nearly as large as "Everyone" (unbounded
// cousin-degree walks every ancestor back however many generations the
// tree records — see docs/FAMILY-PERIMETER-AND-5000-PERSON-PERFORMANCE.md
// §3.6), and a proportional area chart would either look broken or bury
// the very distinction someone opened this sheet to check. The exact
// counts live in the legend below each ring, which is the real source of
// truth; the rings are a recognizable "perimeter" motif, not a chart.
const RING_R = { first: 34, second: 56, third: 76, everyone: 94 };

export default function PerimeterPreview({ graph, viewerId, currentLevel, onClose, onSelectPerson }) {
  const [selected, setSelected] = useState(
    currentLevel && currentLevel !== 'everyone' ? currentLevel : 'first',
  );
  const [q, setQ] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const viewer = viewerId ? graph.byId.get(viewerId) : null;

  // One computePerspectiveIndex per level — the same canonical computation
  // Insights/Home/Timeline already pay for on every relevant render (Phase 0
  // benchmarked this well within budget up to 5,000 people), only ever paid
  // while this sheet is actually open. Deliberately reuses the one shared
  // function rather than a second, preview-specific inclusion calculation —
  // the whole point of computePerspectiveIndex existing is that no product
  // surface reimplements this logic.
  const indexByLevel = useMemo(() => {
    if (!viewer) return {};
    const out = {};
    for (const opt of PERIMETER_OPTIONS) {
      out[opt.value] = computePerspectiveIndex(graph, { viewerId, perimeterLevel: engineLevelFor(opt.value) });
    }
    return out;
  }, [graph, viewerId, viewer]);

  const current = indexByLevel[selected];

  const flatItems = useMemo(() => {
    if (!current) return [];
    const term = q.trim().toLowerCase();
    const byTier = { primary: [], familyHalo: [], partnerContext: [] };
    for (const id of current.perimeterIds) {
      const p = graph.byId.get(id);
      if (!p) continue;
      if (term && !p.display_name.toLowerCase().includes(term)) continue;
      const reason = current.inclusionReasonById.get(id);
      const tier = reason?.tier === 'familyHalo' || reason?.tier === 'partnerContext' ? reason.tier : 'primary';
      byTier[tier].push(p);
    }
    const out = [];
    for (const tier of TIER_ORDER) {
      const people = byTier[tier].sort((a, b) => a.display_name.localeCompare(b.display_name));
      if (!people.length) continue;
      out.push({ type: 'header', key: `h_${tier}`, tier, count: people.length });
      for (const p of people) out.push({ type: 'person', key: p.id, person: p });
    }
    return out;
  }, [current, q, graph]);

  const rowVirtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => listRef.current,
    estimateSize: (i) => (flatItems[i]?.type === 'header' ? HEADER_HEIGHT : ROW_HEIGHT),
    overscan: 10,
  });

  const counts = useMemo(
    () => Object.fromEntries(PERIMETER_OPTIONS.map((o) => [o.value, indexByLevel[o.value]?.perimeterIds.size ?? null])),
    [indexByLevel],
  );

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label="Who's in your Family Perimeter" onClick={onClose}>
      <div className="sheet pp" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />

        <div className="pp__head">
          <ReturnMark onClick={onClose} label="Back to settings" />
          <h2 className="pp__title">Who's in your perimeter</h2>
        </div>

        {!viewer ? (
          <p className="pp__empty">Link your profile to your person in the tree first.</p>
        ) : (
          <>
            <div className="pp__rings-wrap">
              <svg className="pp__rings" viewBox="0 0 200 200" aria-hidden="true">
                {[...PERIMETER_OPTIONS].reverse().map((opt) => (
                  <circle
                    key={opt.value}
                    cx={100} cy={100} r={RING_R[opt.value]}
                    className={`pp__ring pp__ring--${opt.value}${selected === opt.value ? ' pp__ring--on' : ''}`}
                  />
                ))}
                <circle cx={100} cy={100} r={9} className="pp__ring-you" />
              </svg>

              <div className="pp__legend" role="tablist" aria-label="Perimeter level">
                {PERIMETER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    role="tab"
                    aria-selected={selected === opt.value}
                    className={`pp__legend-row${selected === opt.value ? ' pp__legend-row--on' : ''}`}
                    onClick={() => setSelected(opt.value)}
                  >
                    <span className={`pp__legend-dot pp__legend-dot--${opt.value}`} aria-hidden="true" />
                    <span className="pp__legend-label">{opt.label}</span>
                    <span className="pp__legend-count">
                      {counts[opt.value] == null ? '…' : counts[opt.value].toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="pp__search-wrap">
              <input
                className="search"
                type="search"
                placeholder="Search this level…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search this perimeter level"
              />
              {q && (
                <button className="input-clear" onClick={() => setQ('')} aria-label="Clear search" tabIndex={-1}>×</button>
              )}
            </div>

            <div className="pp__list" ref={listRef}>
              {flatItems.length > 0 ? (
                <ul style={{ position: 'relative', height: rowVirtualizer.getTotalSize() }}>
                  {rowVirtualizer.getVirtualItems().map((vRow) => {
                    const item = flatItems[vRow.index];
                    return (
                      <li
                        key={item.key}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vRow.start}px)` }}
                      >
                        {item.type === 'header' ? (
                          <h3 className="pp__group-title">{TIER_LABELS[item.tier]} · {item.count}</h3>
                        ) : (
                          <button className="person-row" onClick={() => onSelectPerson?.(item.person.id)}>
                            <Avatar person={item.person} size={42} />
                            <span className="person-row__text">
                              <span className="person-row__name">{item.person.display_name}</span>
                              <span className="person-row__meta">
                                {current.explanationById.get(item.person.id) || 'Relative.'} · {lifespan(item.person)}
                              </span>
                            </span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="pp__empty">{q ? 'No matches at this level.' : 'Nobody at this level yet.'}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
