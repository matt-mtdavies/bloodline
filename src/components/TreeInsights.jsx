import { useState, useEffect, useMemo, useRef } from 'react';
import { computeInsights, aggregatesHash } from '../lib/insights.js';
import { computeInsightModules, buildInsightHighlights } from '../lib/insightModules.js';
import InsightModules, { PeopleDrawer } from './InsightModules.jsx';
import ReturnMark from './ReturnMark.jsx';
import { timed } from '../lib/perfInstrument.js';

/*
 * Tree Insights sheet — the family archive, felt from the viewer's seat.
 *   • A hero with a count-up of the tree's size + generations.
 *   • A grounded AI "family story" paragraph (cached in localStorage).
 *   • Perspective fact cards that reveal in a gentle stagger.
 *   • Completeness nudges turned into tappable quests.
 */
export default function TreeInsights({ graph, viewerId, cohortIds = null, perimeterActive = false, onNavigate, onClose }) {
  // Family Perimeter (Phase 6 §4.4/§6.9) — `cohortIds` is null for the
  // overwhelming majority (no perimeter narrower than Everyone active), so
  // `scopedGraph === graph` and every module below sees the complete tree,
  // byte-identical to before this feature existed ("Everyone reproduces
  // complete-tree results"). computeInsights has no per-fact cohort
  // granularity of its own (unlike computeInsightModules's per-module
  // MODULE_COHORTS table), so it's handed a PRE-scoped graph directly —
  // every fact/nudge/aggregate it builds iterates `graph.people`, which is
  // exactly what gets filtered here; `graph.byId`/`parents`/`children`/
  // `partners` stay the real, unfiltered graph (same convention as
  // insightModules.js), so the viewer's own connectivity facts ("N
  // generations around you", "N cousins") still reflect real relationships,
  // not just who happens to be inside the personal cohort.
  const scopedGraph = useMemo(() => {
    const ids = cohortIds?.personal;
    if (!ids) return graph;
    return { ...graph, people: graph.people.filter((p) => ids.has(p.id)) };
  }, [graph, cohortIds]);
  const insights = useMemo(() => computeInsights(scopedGraph, viewerId), [scopedGraph, viewerId]);
  // computeInsightModules gets the REAL, unfiltered graph plus cohortIds —
  // it does its OWN per-module scoping (MODULE_COHORTS), since `bridges`
  // declares `complete`, not `personal`, and pre-scoping here would silently
  // break that.
  const modules = useMemo(
    () => timed('computeInsightModules (Tree Insights sheet)', () => computeInsightModules(graph, viewerId, Date.now(), null, null, { cohortIds })),
    [graph, viewerId, cohortIds],
  );
  const { viewer, nudges, aggregates } = insights;
  // §4.3: "Every count says whether it covers your perimeter or the
  // complete tree." Only genuinely differs from `graph.people.length` when
  // a real narrow perimeter is active — null the rest of the time so the
  // hero/AI-aggregate copy below can cheaply tell "should I even mention
  // the complete-tree total" apart from "perimeter narrowed but happens to
  // currently equal the complete tree."
  const completeTotal = perimeterActive && scopedGraph !== graph ? graph.people.length : null;
  // Some text facts are the same number a module now draws — drop the text
  // version when its module renders so nothing appears twice in one sheet:
  // strata replaces "N generations around you"; record books' pool always
  // contains the longest life when one exists.
  const facts = useMemo(() => {
    const drop = new Set();
    if (modules.strata) drop.add('generations');
    if (modules.records) drop.add('longest');
    return drop.size ? insights.facts.filter((f) => !drop.has(f.key)) : insights.facts;
  }, [insights.facts, modules.strata, modules.records]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── AI narrative: cached by a hash of the facts; auto-generate once per hash ──
  // The narrative draws on the same visual modules the sheet already shows —
  // one richer paragraph from a single call, not a separate AI round-trip per
  // module (11x the cost/latency for a garnish, not the point).
  const highlights = useMemo(() => buildInsightHighlights(modules), [modules]);
  // §6.9: "AI receives cohort-labelled aggregates only" — `cohort` names
  // exactly which population these numbers describe, and `totalInCompleteTree`
  // (only present when it actually differs — see completeTotal above) lets
  // the server-side prompt distinguish "your Family Perimeter" from "the
  // complete family tree" per §4.3, rather than writing an unlabelled
  // `Total people in the tree: N` straight into the prompt regardless of
  // whether N is scoped or not.
  const enrichedAggregates = useMemo(() => {
    const base = highlights ? { ...aggregates, highlights } : aggregates;
    return {
      ...base,
      cohort: 'personal',
      ...(completeTotal != null ? { totalInCompleteTree: completeTotal } : {}),
    };
  }, [aggregates, highlights, completeTotal]);
  const hash = useMemo(() => aggregatesHash(enrichedAggregates), [enrichedAggregates]);
  // §6.9: "cache keys include family revision, viewer ID and perimeter
  // setting" — the content hash alone already varies WITH cohort content
  // (a narrower personal cohort produces different aggregates), but an
  // explicit dimension is what the spec actually asks for, not an
  // incidental side effect of two different scopes rarely hashing the
  // same. `graph.people.length` stands in for "family revision" (no
  // explicit revision counter exists yet in this client) — good enough to
  // invalidate the cache the moment the tree's own size changes, which a
  // pure content hash of the (potentially narrower) aggregates might not
  // otherwise catch. `perimeterActive` intentionally folds the exact level
  // string in only when it's actually narrowing anything — an inactive
  // perimeter (the overwhelming majority) keeps the pre-Phase-6 cache key
  // shape exactly, so nobody's already-cached narrative is invalidated by
  // this change alone.
  const cacheKey = `bl_insight_${viewerId || 'v'}_${perimeterActive ? 'p' : 'all'}_${graph.people.length}_${hash}`;
  const [narrative, setNarrative] = useState(() => {
    try { return localStorage.getItem(cacheKey) || ''; } catch { return ''; }
  });
  const [aiState, setAiState] = useState(narrative ? 'done' : 'idle'); // idle|loading|done|unavailable|error
  const triedRef = useRef(false);

  async function generate() {
    setAiState('loading');
    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aggregates: enrichedAggregates }),
      });
      if (res.status === 503) { setAiState('unavailable'); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.narrative) { setAiState('error'); return; }
      setNarrative(body.narrative);
      setAiState('done');
      try { localStorage.setItem(cacheKey, body.narrative); } catch { /* quota — fine */ }
    } catch {
      setAiState('error');
    }
  }

  // Auto-generate on first view of a given facts-hash (then it's cached/free).
  useEffect(() => {
    if (narrative || triedRef.current) return;
    triedRef.current = true;
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  const heroNum = useCountUp(aggregates?.totalPeople ?? 0);
  // Which nudge's "+N more" drawer is open, if any — the full list behind
  // the 4-wide chip preview, so "+497 more" is an actual way in rather than
  // just a bigger number.
  const [openNudgeKey, setOpenNudgeKey] = useState(null);
  const openNudge = nudges.find((n) => n.key === openNudgeKey) || null;

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label="Tree insights" onClick={onClose}>
      <div className="sheet ti" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />

        <div className="ti__head">
          <ReturnMark onClick={onClose} />
          <h2 className="ti__title"><SparkIcon /> Tree insights</h2>
        </div>

        {/* Hero */}
        <div className="ti__hero">
          <div className="ti__hero-aurora" aria-hidden="true" />
          <div className="ti__hero-stat">
            <span className="ti__hero-num">{heroNum}</span>
            {/* §4.3: never an unlabelled count when the cohort could be
                ambiguous — "people in your tree" is fine while Everyone
                already means the complete tree (the overwhelming majority),
                but the instant a real perimeter narrows it, this number IS
                the personal cohort, not the whole family, and has to say so. */}
            <span className="ti__hero-label">{completeTotal != null ? 'people within your Family Perimeter' : 'people in your tree'}</span>
          </div>
          {completeTotal != null && (
            <div className="ti__hero-complete">{completeTotal} in the complete family tree</div>
          )}
          {aggregates?.generations > 0 && (
            <div className="ti__hero-sub">{aggregates.generations} generations
              {viewer?.firstName ? <> · with you, {viewer.firstName}, in the middle</> : null}
            </div>
          )}
        </div>

        {/* AI narrative */}
        {aiState !== 'unavailable' && (
          <div className="ti__story">
            {aiState === 'loading' && (
              <div className="ti__story-loading">
                <span className="ti__shimmer" /><span className="ti__shimmer" /><span className="ti__shimmer ti__shimmer--short" />
                <p className="ti__story-hint">Reading your family story…</p>
              </div>
            )}
            {aiState === 'done' && narrative && (
              <p className="ti__story-text">{narrative}</p>
            )}
            {(aiState === 'error') && (
              <button className="ti__story-retry" onClick={generate}>Couldn't write your story — tap to retry</button>
            )}
            {aiState === 'done' && (
              <button className="ti__story-regen" onClick={generate} aria-label="Regenerate">
                <RefreshIcon /> Regenerate
              </button>
            )}
          </div>
        )}

        {/* The visual modules — the drawn comparisons, in chapters */}
        <InsightModules modules={modules} graph={graph} onNavigate={onNavigate} />

        {/* Perspective facts */}
        {facts.length > 0 && (
          <div className="ti__facts">
            {facts.map((f, i) => (
              <button
                key={f.key}
                className="ti__fact"
                style={{ animationDelay: `${i * 60}ms` }}
                onClick={() => f.personId && onNavigate?.(f.personId)}
                disabled={!f.personId}
              >
                <span className="ti__fact-icon"><FactIcon name={f.icon} /></span>
                <span className="ti__fact-body">
                  <span className="ti__fact-title">{f.title}</span>
                  <span className="ti__fact-detail">{f.detail}</span>
                </span>
                {f.personId && <span className="ti__fact-go"><ChevronRightIcon /></span>}
              </button>
            ))}
          </div>
        )}

        {/* Completeness nudges */}
        {nudges.length > 0 && (
          <div className="ti__nudges">
            <h3 className="ti__nudges-head">Help complete the archive</h3>
            {nudges.map((n) => (
              <div key={n.key} className="ti__nudge">
                <p className="ti__nudge-label">
                  <strong>{n.total}</strong> {n.total === 1 ? 'person' : 'people'} {n.label}
                </p>
                <div className="ti__nudge-chips">
                  {n.people.map((p) => (
                    <button key={p.id} className="ti__chip" onClick={() => onNavigate?.(p.id)}>
                      {p.name.split(/\s+/)[0]}
                    </button>
                  ))}
                  {n.total > n.people.length && (
                    <button
                      className="ti__chip ti__chip--more"
                      onClick={() => setOpenNudgeKey(n.key)}
                    >
                      +{n.total - n.people.length} more
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {openNudge && (
          <PeopleDrawer
            title={`${openNudge.total} ${openNudge.total === 1 ? 'person' : 'people'} ${openNudge.label}`}
            rows={openNudge.all}
            graph={graph}
            onNavigate={onNavigate}
            onClose={() => setOpenNudgeKey(null)}
          />
        )}

        <p className="ti__foot">Insights are generated from your tree and stay private to your family.</p>
      </div>
    </div>
  );
}

// Eased count-up for the hero number.
function useCountUp(target, duration = 900) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!target) { setN(0); return; }
    let raf; const start = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return n;
}

function FactIcon({ name }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true };
  switch (name) {
    case 'roots': return (<svg {...p}><path d="M12 3v8m0 0c0 3-3 4-3 7m3-7c0 3 3 4 3 7M12 11l-4-3m4 3l4-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>);
    case 'people': return (<svg {...p}><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7"/><path d="M3.5 19a5.5 5.5 0 0111 0M16 6.5a3 3 0 010 5.8M20.5 19a5.5 5.5 0 00-4-5.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>);
    case 'heart': return (<svg {...p}><path d="M12 20s-7-4.5-9.2-9C1.3 8 3 4.5 6.3 4.5c2 0 3.2 1.3 3.7 2.2.5-.9 1.7-2.2 3.7-2.2C20 4.5 21.7 8 21.2 11 19 15.5 12 20 12 20z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>);
    case 'time': return (<svg {...p}><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7"/><path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>);
    case 'star': return (<svg {...p}><path d="M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.5 6.9 19.2l1-5.6-4.1-4 5.7-.8L12 3.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>);
    case 'layers': default: return (<svg {...p}><path d="M12 3l9 5-9 5-9-5 9-5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M3 13l9 5 9-5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>);
  }
}

function SparkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="ti__spark">
      <path d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8L12 3z" fill="currentColor"/>
      <path d="M19 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7L19 14z" fill="currentColor" opacity="0.7"/>
    </svg>
  );
}
function ChevronRightIcon() {
  return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
function RefreshIcon() {
  return (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 12a9 9 0 11-2.6-6.4M21 4v4h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>);
}
