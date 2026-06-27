import { useState, useMemo, useEffect, useRef } from 'react';
import { buildTimeline, bucketOf, groupByDecade } from '../lib/timeline.js';

/*
 * Family Timeline — the whole family's history as one chronological feed:
 * births, milestones, deaths and photographs, grouped by decade along a spine.
 * Editorial, not list-y; entries reveal as they scroll into view.
 */
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'births', label: 'Births' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'photos', label: 'Photos' },
];

export default function TimelineView({ graph, photos = [], onNavigate, onClose }) {
  const [filter, setFilter] = useState('all');
  const all = useMemo(() => buildTimeline(graph, photos), [graph, photos]);
  const filtered = useMemo(
    () => (filter === 'all' ? all : all.filter((e) => bucketOf(e.type) === filter)),
    [all, filter],
  );
  const groups = useMemo(() => groupByDecade(filtered), [filtered]);
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
            <section key={g.decade} className="tl__decade">
              <div className="tl__decade-head"><span className="tl__decade-label">{g.label}</span></div>
              {g.entries.map((e) => (
                <button
                  key={e.key}
                  className={`tl-entry tl-entry--${e.type}`}
                  onClick={() => e.personId && onNavigate?.(e.personId)}
                >
                  <span className="tl-entry__rail"><span className="tl-entry__dot"><EntryIcon type={e.type} /></span></span>
                  <span className="tl-entry__card">
                    <span className="tl-entry__year">{e.year}</span>
                    <span className="tl-entry__title">{e.title}</span>
                    {e.detail && <span className="tl-entry__detail">{e.detail}</span>}
                    {e.type !== 'birth' && e.type !== 'death' && e.who && (
                      <span className="tl-entry__who">{e.who}</span>
                    )}
                    {e.photoSrc && (
                      <span className="tl-entry__photo"><img src={e.photoSrc} alt="" loading="lazy" /></span>
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

function ClockIcon() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/><path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function CloseIcon() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>);
}
