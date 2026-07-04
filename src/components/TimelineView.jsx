import { useState, useMemo, useEffect, useRef } from 'react';
import { buildTimeline, bucketOf, groupByDecade } from '../lib/timeline.js';
import { detectRegion, worldEventsInDecade, sameYearWorldEvent, eraTint } from '../lib/worldEvents.js';
import { CATEGORY_LABELS } from '../data/worldEvents.js';

/*
 * Family Timeline — the whole family's history as one chronological feed:
 * births, milestones, deaths and photographs, grouped by decade along a spine.
 * Editorial, not list-y; entries reveal as they scroll into view.
 *
 * World history rides alongside it as quiet context, not content: a curated
 * spine of well-known events (data/worldEvents.js) biased toward wherever
 * the tree's own people are actually from, woven in only on the "All" view
 * so filtering to a specific kind of family moment stays focused. A birth
 * that lands on the same year as a world event gets a one-line echo right
 * on its own card — the specific, personal connection — rather than fewer,
 * blander read-more-history cards.
 */
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'births', label: 'Births' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'photos', label: 'Photos' },
];

// Weaves world-history entries into each decade group (world entries always
// last for the year, so the family's own moment still opens it) and attaches
// a same-year "echo" to any birth that lines up with a world event exactly —
// that event is then left out of the decade's standalone world cards so the
// same fact never appears twice in one section.
function withWorldContext(groups, region) {
  return groups.map((g) => {
    const consumed = new Set();
    const entries = g.entries.map((e) => {
      if (e.type !== 'birth') return e;
      const echo = sameYearWorldEvent(e.year, region);
      if (!echo) return e;
      consumed.add(`${echo.year}|${echo.title}`);
      return { ...e, worldEcho: echo };
    });
    const standalone = worldEventsInDecade(g.decade, region)
      .filter((ev) => !consumed.has(`${ev.year}|${ev.title}`))
      .map((ev) => ({
        key: `w_${ev.year}_${ev.title}`,
        year: ev.year,
        type: 'world',
        title: ev.title,
        detail: ev.detail || null,
        category: ev.category,
      }));
    const merged = [...entries, ...standalone].sort(
      (a, b) => a.year - b.year || (a.type === 'world') - (b.type === 'world'),
    );
    return { ...g, entries: merged, tint: eraTint(g.decade) };
  });
}

export default function TimelineView({ graph, photos = [], onNavigate, onClose }) {
  const [filter, setFilter] = useState('all');
  const all = useMemo(() => buildTimeline(graph, photos), [graph, photos]);
  const region = useMemo(() => detectRegion(graph), [graph]);
  const filtered = useMemo(
    () => (filter === 'all' ? all : all.filter((e) => bucketOf(e.type) === filter)),
    [all, filter],
  );
  const groups = useMemo(() => {
    const base = groupByDecade(filtered);
    return filter === 'all' ? withWorldContext(base, region) : base;
  }, [filtered, filter, region]);
  const span = all.length ? `${all[0].year}–${all[all.length - 1].year}` : '';

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  // Reveal entries as they scroll into the sheet.
  const scrollRef = useRef(null);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }),
      { root, threshold: 0.12 },
    );
    root.querySelectorAll('.tl-entry:not(.is-in)').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [groups]);

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label="Family timeline" onClick={onClose}>
      <div className="sheet tl" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />

        <div className="tl__head">
          <div>
            <h2 className="tl__title"><ClockIcon /> Family timeline</h2>
            {span && <p className="tl__span">{all.length} moments · {span}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>

        <div className="tl__filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`tl__filter${filter === f.key ? ' tl__filter--on' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="tl__scroll" ref={scrollRef}>
          {groups.length === 0 ? (
            <p className="tl__empty">No dated moments yet — add birth years and life events to build your family's story.</p>
          ) : groups.map((g) => (
            <section key={g.decade} className="tl__decade" style={g.tint ? { '--era-tint': g.tint } : undefined}>
              <div className="tl__decade-head"><span className="tl__decade-label">{g.label}</span></div>
              {g.entries.map((e) => (
                <button
                  key={e.key}
                  className={`tl-entry tl-entry--${e.type}`}
                  onClick={() => e.personId && onNavigate?.(e.personId)}
                >
                  <span className="tl-entry__rail">
                    <span className="tl-entry__dot">
                      {e.type === 'world' ? <CategoryIcon category={e.category} /> : <EntryIcon type={e.type} />}
                    </span>
                  </span>
                  <span className="tl-entry__card">
                    <span className="tl-entry__year">{e.year}</span>
                    <span className="tl-entry__title">{e.title}</span>
                    {e.detail && <span className="tl-entry__detail">{e.detail}</span>}
                    {e.type === 'world' && (
                      <span className="tl-entry__category">{CATEGORY_LABELS[e.category] || 'World'}</span>
                    )}
                    {e.type !== 'birth' && e.type !== 'death' && e.type !== 'world' && e.who && (
                      <span className="tl-entry__who">{e.who}</span>
                    )}
                    {e.photoSrc && (
                      <span className="tl-entry__photo"><img src={e.photoSrc} alt="" loading="lazy" /></span>
                    )}
                    {e.worldEcho && (
                      <span className="tl-entry__echo">
                        <GlobeIcon /> Also {e.year}: {e.worldEcho.title}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function EntryIcon({ type }) {
  const p = { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };
  switch (type) {
    case 'birth': return (<svg {...p}><path d="M12 21c0-5 0-8 0-8m0 0c-4 0-6-2-6-5 3 0 6 1 6 5zm0 0c0-4 3-6 6-5 0 3-2 5-6 5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>);
    case 'death': return (<svg {...p}><path d="M12 3a6 6 0 016 6c0 4-6 12-6 12S6 13 6 9a6 6 0 016-6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>);
    case 'photo': return (<svg {...p}><rect x="3" y="6" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="13" r="3.2" stroke="currentColor" strokeWidth="1.8"/><path d="M8 6l1.5-2h5L16 6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>);
    default: return (<svg {...p}><path d="M12 3.5l2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.7L7.2 18.4l1-5.4-4-3.8 5.4-.7L12 3.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>);
  }
}

// One quiet line-icon per world-event category, same weight/size as the
// family EntryIcon set above so a world card's dot reads as a sibling to the
// family dots, not a foreign element — just a different, muted color.
function CategoryIcon({ category }) {
  const p = { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };
  switch (category) {
    case 'conflict': return (<svg {...p}><path d="M6 3l6 6M18 3l-6 6M12 9v5m0 0l-4 7m4-7l4 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>);
    case 'invention': return (<svg {...p}><path d="M9 18h6M10 21h4M12 3a5.5 5.5 0 0 0-3 10.1c.6.4 1 1.1 1 1.9h4c0-.8.4-1.5 1-1.9A5.5 5.5 0 0 0 12 3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>);
    case 'culture': return (<svg {...p}><path d="M12 3.5l2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.7L7.2 18.4l1-5.4-4-3.8 5.4-.7L12 3.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>);
    case 'politics': return (<svg {...p}><path d="M5 3v18M5 4h11l-2.5 3.5L16 11H5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>);
    case 'science': return (<svg {...p}><path d="M10 2h4M11 2v6.5L5.5 19a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3L13 8.5V2" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M8 15h8" stroke="currentColor" strokeWidth="1.6"/></svg>);
    case 'exploration': return (<svg {...p}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7"/><path d="M15 9l-2 6-6 2 2-6 6-2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>);
    default: return <GlobeIcon />;
  }
}

function GlobeIcon() {
  return (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" stroke="currentColor" strokeWidth="1.5"/></svg>);
}

function ClockIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/><path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function CloseIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>);
}
