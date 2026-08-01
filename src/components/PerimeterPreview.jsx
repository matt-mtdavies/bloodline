import { useState, useMemo, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Avatar from './Avatar.jsx';
import ReturnMark from './ReturnMark.jsx';
import PerimeterGenogram from './PerimeterGenogram.jsx';
import { lifespan } from '../lib/dates.js';
import { computePerspectiveIndex } from '../lib/perspectiveIndex.js';
import { PERIMETER_OPTIONS, engineLevelFor } from '../lib/familyPerimeter.js';
import { CATEGORY_META, secondarySortValue, groupPeopleByCategory } from '../lib/perimeterCategories.js';

// Matches AccessibleTree.jsx's DIRECTORY_ROW_HEIGHT convention — a
// person-row is 62px + a 6px gap, baked into the fixed stride the
// virtualizer positions rows at.
const ROW_HEIGHT = 68;
const HEADER_HEIGHT = 40;

// One-line descriptions of how each level is derived — drawn straight from
// the engine's own rules (§3.5/§3.6), not marketing copy, so the "why is
// this person in/out" question the preview exists to answer is answered in
// words too, not just a list.
const LEVEL_DESCRIPTIONS = {
  first: 'Your direct ancestors and descendants, plus first cousins from every branch — even ones many generations back.',
  second: 'Everything in Close family, plus second cousins — people who share a great-great-grandparent with you.',
  third: 'Everything in Extended family, plus third cousins.',
  everyone: 'Everyone recorded in the family, with no limit.',
};

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

// Short on-ring labels + the angle (degrees, clockwise from 12 o'clock) each
// one sits at — fanned out around the top-right quadrant rather than all
// stacked at 12 o'clock, so the four labels never overlap each other
// regardless of ring radius. Full names stay in the legend rows beside the
// diagram; these exist purely so the ring-to-level mapping doesn't rely on
// matching colors by eye.
const RING_LABEL = { first: '1st', second: '2nd', third: '3rd', everyone: 'All' };
const RING_LABEL_ANGLE = { first: -18, second: 22, third: 52, everyone: 80 };
function ringLabelPos(r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: 100 + r * Math.sin(rad), y: 100 - r * Math.cos(rad) };
}

export default function PerimeterPreview({ graph, viewerId, currentLevel, onClose, onSelectPerson }) {
  const [selected, setSelected] = useState(
    currentLevel && currentLevel !== 'everyone' ? currentLevel : 'first',
  );
  const [diagramMode, setDiagramMode] = useState('rings');
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
    const byCategory = groupPeopleByCategory(current, viewerId, graph, { filterTerm: term || undefined });
    const cats = [...byCategory.keys()].sort(
      (a, b) => (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99),
    );
    const out = [];
    for (const cat of cats) {
      const entries = byCategory.get(cat);
      entries.sort((x, y) => {
        const sx = secondarySortValue(x.person.id, viewerId, x.reason);
        const sy = secondarySortValue(y.person.id, viewerId, y.reason);
        if (sx !== sy) return sx - sy;
        return x.person.display_name.localeCompare(y.person.display_name);
      });
      out.push({ type: 'header', key: `h_${cat}`, label: CATEGORY_META[cat]?.label ?? 'Other', count: entries.length });
      for (const e of entries) out.push({ type: 'person', key: e.person.id, person: e.person });
    }
    return out;
  }, [current, q, graph, viewerId]);

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

  // A tap on a genogram chip jumps the (already-rendered, shared) list
  // straight to that category — a no-op if there's no header for it (an
  // empty category has none; PerimeterGenogram itself already only wires
  // taps up for chips that have someone in them).
  const scrollToCategory = (cat) => {
    const idx = flatItems.findIndex((item) => item.type === 'header' && item.key === `h_${cat}`);
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'start' });
  };

  // Shared between both diagram modes — the level picker itself doesn't
  // change, only what's drawn above it (rings vs. the genogram), and both
  // modes still need it since the description/search/list below all key
  // off `selected`. Genogram mode renders it `compact` (a wrapped row of
  // small pills instead of four full-width rows) — the diagram below it is
  // real, variable-height content in a way the fixed rings graphic never
  // was, and giving the picker its full vertical footprint on top of that
  // was squeezing the person list underneath down to almost nothing (a
  // real bug: it measured out to a literal 0px list on some screens).
  const renderLegend = (compact = false) => (
    <div className={`pp__legend${compact ? ' pp__legend--compact' : ''}`} role="tablist" aria-label="Perimeter level">
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
            <div className="pp__tabs" role="tablist" aria-label="Diagram style">
              <button
                role="tab"
                aria-selected={diagramMode === 'rings'}
                className={`pp__tab${diagramMode === 'rings' ? ' pp__tab--on' : ''}`}
                onClick={() => setDiagramMode('rings')}
              >
                Rings
              </button>
              <button
                role="tab"
                aria-selected={diagramMode === 'genogram'}
                className={`pp__tab${diagramMode === 'genogram' ? ' pp__tab--on' : ''}`}
                onClick={() => setDiagramMode('genogram')}
              >
                Family tree
              </button>
            </div>

            {diagramMode === 'rings' ? (
              <div className="pp__rings-wrap">
                <svg className="pp__rings" viewBox="0 0 200 200" aria-hidden="true">
                  {[...PERIMETER_OPTIONS].reverse().map((opt) => (
                    <circle
                      key={opt.value}
                      cx={100} cy={100} r={RING_R[opt.value]}
                      className={`pp__ring pp__ring--${opt.value}${selected === opt.value ? ' pp__ring--on' : ''}`}
                    />
                  ))}
                  {PERIMETER_OPTIONS.map((opt) => {
                    const { x, y } = ringLabelPos(RING_R[opt.value], RING_LABEL_ANGLE[opt.value]);
                    return (
                      <text
                        key={opt.value}
                        x={x} y={y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className={`pp__ring-label pp__ring-label--${opt.value}${selected === opt.value ? ' pp__ring-label--on' : ''}`}
                      >
                        {RING_LABEL[opt.value]}
                      </text>
                    );
                  })}
                  <circle cx={100} cy={100} r={9} className="pp__ring-you" />
                </svg>

                {renderLegend()}
              </div>
            ) : (
              <div className="pp__geno-section">
                {renderLegend(true)}
                <PerimeterGenogram
                  current={current}
                  viewerId={viewerId}
                  graph={graph}
                  engineLevel={engineLevelFor(selected)}
                  onSelectCategory={scrollToCategory}
                />
              </div>
            )}

            <p className="pp__level-desc">{LEVEL_DESCRIPTIONS[selected]}</p>

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
                          <h3 className="pp__group-title">{item.label} · {item.count}</h3>
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
