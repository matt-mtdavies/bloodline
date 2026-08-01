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

// Fine-grained category buckets, derived entirely from the canonical
// inclusionReasonById entry perspectiveIndex.js already computes for every
// perimeter member — no new inclusion logic, just a finer read of the same
// route/closeness/degree fields. Replaces the earlier flat 3-tier grouping
// (primary/familyHalo/partnerContext), which lumped e.g. a parent and a
// 3rd cousin into one undifferentiated "Direct family & cousins" bucket.
//
// Deliberately does NOT split by which anchor (viewer vs. current partner)
// produced an ancestor/descendant/cousin route — both anchors' primary
// perimeters are folded into the same generation/degree bucket, since from
// a shared-household perspective "your parents" and "your partner's
// parents" both just read as "Parents" here. Only the family-halo and
// partner-context TIERS (routes that are inherently about someone else's
// connections, not a shared lineage) get their own "via your partner"-style
// buckets.
const CATEGORY_META = {
  you: { label: 'You & your partner', order: 0 },
  parents: { label: 'Parents', order: 1 },
  siblings: { label: 'Siblings', order: 2 },
  children: { label: 'Children', order: 3 },
  grandparents: { label: 'Grandparents', order: 4 },
  grandchildren: { label: 'Grandchildren', order: 5 },
  greatGrandparents: { label: 'Great-grandparents & further back', order: 6 },
  greatGrandchildren: { label: 'Great-grandchildren & further on', order: 7 },
  cousins1: { label: '1st cousins', order: 8 },
  cousins2: { label: '2nd cousins', order: 9 },
  cousins3: { label: '3rd cousins', order: 10 },
  halo: { label: 'Connected through marriage', order: 11 },
  partnerFamily: { label: "Your partner's family", order: 12 },
  everyone: { label: 'Everyone in your tree', order: 13 },
  other: { label: 'Other', order: 14 },
};

// Resolves which bucket a perimeter member belongs in from their canonical
// reason alone. `route: 'everyone'` (only ever produced at the Complete
// family tree level — see perspectiveIndex.js's own comment on why it
// "skips cousin calculation entirely") carries no real relationship route,
// so everyone there collapses to one bucket except the viewer/current
// partner themselves, checked directly against graph.partners.
function categoryFor(id, viewerId, graph, reason) {
  if (!reason) return 'other';
  if (reason.tier === 'familyHalo') return 'halo';
  if (reason.tier === 'partnerContext') return 'partnerFamily';
  if (reason.route === 'everyone') {
    if (id === viewerId) return 'you';
    return graph.partners(viewerId).some((p) => p.id === id && p.status === 'current') ? 'you' : 'everyone';
  }
  if (reason.route === 'anchor') return 'you';
  if (reason.route === 'ancestor') {
    const dist = reason.closeness?.[0] ?? 0;
    if (dist === 1) return 'parents';
    if (dist === 2) return 'grandparents';
    return 'greatGrandparents';
  }
  if (reason.route === 'descendant') {
    const dist = reason.closeness?.[0] ?? 0;
    if (dist === 1) return 'children';
    if (dist === 2) return 'grandchildren';
    return 'greatGrandchildren';
  }
  if (reason.route === 'cousin') {
    // A shared parent (upA=downB=1) resolves to degree 0 here — a full/half
    // sibling reached via the same ancestor-then-descend collateral walk
    // that finds real cousins, not a separate concept. Gets its own bucket
    // rather than falling through to "3rd cousins" (the un-handled default
    // this replaced), and deliberately distinct from step-siblings, which
    // only ever qualify via the familyHalo tier's own 'sibling' route above
    // and land in "Connected through marriage" — the same biological/
    // adoptive-vs-step split the rest of the app already draws.
    const degree = reason.degree ?? reason.closeness?.[0] ?? 1;
    if (degree === 0) return 'siblings';
    if (degree === 1) return 'cousins1';
    if (degree === 2) return 'cousins2';
    return 'cousins3';
  }
  return 'other';
}

// Within a category, order by closeness to the viewer first (matches the
// rings' own "radiating outward from you" metaphor, and the search box
// already covers "find a specific name"), alphabetical as the tiebreak —
// never the other way around. The viewer themself always leads "You & your
// partner" regardless of name.
function secondarySortValue(id, viewerId, reason) {
  if (id === viewerId) return -1;
  if (!reason) return 0;
  if (reason.route === 'cousin') return reason.removal ?? 0;
  return reason.closeness?.[0] ?? 0;
}

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
    const byCategory = new Map();
    for (const id of current.perimeterIds) {
      const p = graph.byId.get(id);
      if (!p) continue;
      if (term && !p.display_name.toLowerCase().includes(term)) continue;
      const reason = current.inclusionReasonById.get(id);
      const cat = categoryFor(id, viewerId, graph, reason);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push({ person: p, reason });
    }
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
