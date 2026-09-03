/*
 * The Atlas lab — the whole family as one navigable world.
 *
 * Exists to answer one question with evidence rather than opinion: does a
 * 1,000+ person family, laid out once, deterministically, and travelled with
 * a continuous camera, read as something remarkable? Fixture-first like the
 * other labs: the representative 1,200-person fixture loads on mount (the
 * standing rule is real or representative data, never the 23-person demo),
 * and your real tree is loaded only by an explicit button press through the
 * same read-only GET the other labs already use.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildGraph } from '../../data/graph.js';
import { people as seedPeople, relationships as seedRels, DEFAULT_FOCUS } from '../../data/seed.js';
import { generateFamilyFixture } from '../../lib/fixtureGenerator.js';
import { fetchRealFamily } from '../v2/realFamily.js';
import AtlasStage from './AtlasStage.jsx';
import '../../styles/theme.css';
import './atlas.css';

/* Stand-in portraits for the fixture (it ships with none, and this design
 * lives on faces): a warm ground and a head-and-shoulders silhouette, as a
 * data URI — the same stand-ins tests/canopy-visual.mjs already uses. */
const GROUNDS = ['#8d7f6e', '#7d8a72', '#9a8570', '#79837f', '#94807a', '#87826f'];
function portrait(i) {
  const g = GROUNDS[i % GROUNDS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="${g}"/><circle cx="80" cy="64" r="30" fill="rgba(255,252,246,0.86)"/><path d="M21 160c0-35 27-56 59-56s59 21 59 56z" fill="rgba(255,252,246,0.86)"/></svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}
function representative() {
  const { tree } = generateFamilyFixture({ size: 1200, seed: 7 });
  tree.people.forEach((p, i) => { p.photo = i % 4 === 3 ? null : portrait(i); });
  return { label: 'Representative family', people: tree.people, relationships: tree.relationships, focus: tree.myPersonId };
}

function lifespan(p) {
  const b = (p.birth_date || '').slice(0, 4), d = (p.death_date || '').slice(0, 4);
  if (p.is_deceased) return b || d ? `${b || '?'} – ${d || '?'}` : 'In memory';
  return b ? `b. ${b}` : '';
}

export default function AtlasLab() {
  const [source, setSource] = useState(() => representative());
  const [focusId, setFocusId] = useState(null);
  const [year, setYear] = useState(null);
  const [timeOn, setTimeOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [stats, setStats] = useState(null);
  const [edges, setEdges] = useState([]);
  const api = useRef(null);

  const graph = useMemo(() => buildGraph(source.people, source.relationships), [source]);
  // Arrival: the whole family blooms first, then the camera flies to you
  // and lights your line through it — the map, then where you are on it.
  useEffect(() => {
    setFocusId(null); setYear(null); setTimeOn(false);
    if (!source.focus) return undefined;
    const t = setTimeout(() => setFocusId(source.focus), 1600);
    return () => clearTimeout(t);
  }, [source]);

  const years = useMemo(() => {
    const ys = source.people.map((p) => Number(String(p.birth_date || '').slice(0, 4))).filter((y) => y > 1000);
    return ys.length ? { min: Math.min(...ys), max: Math.max(...ys, new Date().getFullYear()) } : { min: 1800, max: 2026 };
  }, [source]);

  const loadReal = async () => {
    setLoading(true); setError('');
    try { setSource({ label: 'Your family', ...(await fetchRealFamily()) }); }
    catch (e) { setError(e.message || 'Could not load your family.'); }
    finally { setLoading(false); }
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return source.people.filter((p) => (p.display_name || '').toLowerCase().includes(q)).slice(0, 8);
  }, [query, source]);

  const active = focusId ? graph.byId.get(focusId) : null;
  const toggleTime = () => {
    if (timeOn) { setTimeOn(false); setYear(null); }
    else { setTimeOn(true); setYear(Math.round((years.min + years.max) / 2)); }
  };

  return (
    <div className="atlab">
      <header className="atlab__bar">
        <span className="atlab__title">Atlas</span>
        <span className="atlab__src">{source.label} · {source.people.length.toLocaleString()} people</span>
        <div className="atlab__seg" role="group" aria-label="Family source">
          <button type="button" className={source.label === 'Representative family' ? 'is-on' : ''} onClick={() => setSource(representative())}>1,200 people</button>
          <button type="button" className={source.label === 'Demo family' ? 'is-on' : ''} onClick={() => setSource({ label: 'Demo family', people: seedPeople, relationships: seedRels, focus: DEFAULT_FOCUS })}>Demo</button>
        </div>
        <div className="atlab__search">
          <input className="atlab__input" value={query} placeholder="Fly to someone…" onChange={(e) => setQuery(e.target.value)} aria-label="Find someone to fly to" />
          {!!results.length && (
            <ul className="atlab__results">
              {results.map((p) => (
                <li key={p.id}><button type="button" onClick={() => { setFocusId(p.id); setQuery(''); }}>{p.display_name}<small>{lifespan(p)}</small></button></li>
              ))}
            </ul>
          )}
        </div>
        <button className="atlab__btn" type="button" onClick={loadReal} disabled={loading}>{loading ? 'Loading…' : 'Load your real family'}</button>
      </header>
      {!!error && <p className="atlab__error">{error}</p>}

      <div className="atlas-wrap" style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, display: 'flex' }}>
        <AtlasStage
          graph={graph}
          focusId={focusId}
          year={year}
          onSelect={setFocusId}
          onOpen={() => {}}
          onLayout={setStats}
          onEdge={setEdges}
          apiRef={api}
        />

        {/* Off-screen relatives of the selected person, as map markers at the
            edge of the view: tap one to fly there. */}
        {edges.map((c) => (
          <button
            key={c.key}
            type="button"
            className="atlab__edge"
            style={{ left: c.x, top: c.y }}
            onClick={() => setFocusId(c.ids[0])}
            aria-label={`Fly to ${c.label}`}
          >
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" style={{ transform: `rotate(${c.angle}rad)` }}>
              <path d="M2 6h7M6 2.5L9.5 6 6 9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{c.label}</span>
          </button>
        ))}

        <div className="atlab__corner">
          <button className="atlab__btn" type="button" onClick={() => api.current?.fitAll()}>Whole family</button>
          <button className={'atlab__btn' + (timeOn ? ' atlab__btn--accent' : '')} type="button" onClick={toggleTime}>{timeOn ? 'Time on' : 'Time'}</button>
        </div>

        {!active && !timeOn && (
          <p className="atlab__hint">
            This is everyone, laid out once. <strong>Zoom in</strong>, drag to pan, <strong>tap anyone</strong> to fly to them and light their bloodline.
          </p>
        )}
        {!!active && (
          <div className="atlab__foot">
            <span className="name">{active.display_name}</span>
            <span>{lifespan(active)}</span>
            <button className="atlab__link" type="button" onClick={() => api.current?.flyTo(active.id)}>Re-centre</button>
            <button className="atlab__link" type="button" onClick={() => { setFocusId(null); api.current?.fitAll(); }}>Clear</button>
          </div>
        )}
        {timeOn && (
          <div className="atlab__time">
            <span className="year">{year}</span>
            <input type="range" min={years.min} max={years.max} value={year ?? years.min} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" />
            <button className="atlab__link" type="button" onClick={toggleTime}>Done</button>
          </div>
        )}
        {!!stats && (
          <div className="atlab__stats">
            {stats.people.toLocaleString()} people · {stats.generations} generations · {stats.lateralUnions} lateral unions · {stats.longDescents} far-reaching links · laid out in {stats.layoutMs}ms
          </div>
        )}
      </div>
    </div>
  );
}
