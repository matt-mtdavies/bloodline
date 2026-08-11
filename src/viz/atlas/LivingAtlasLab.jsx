import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGraph } from '../../data/graph.js';
import { initials, monogramColors } from '../../lib/color.js';
import { gedcomToStore } from '../../lib/gedcom.js';
import { FIXTURES, fixtureById } from '../v2/fixtures.js';
import { createAtlasModel } from './model.js';
import './living-atlas.css';

const DEFAULT_VIEWPORT = { width: 1200, height: 760 };

function useViewport(ref) {
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  useEffect(() => {
    if (!ref.current) return undefined;
    const update = () => {
      const box = ref.current.getBoundingClientRect();
      const mobile = box.width < 620;
      setViewport({ width: Math.max(320, box.width), height: Math.max(mobile ? 500 : 560, box.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return viewport;
}

function personName(person) {
  return person?.display_name || [person?.given_names, person?.family_name].filter(Boolean).join(' ') || 'Unknown relative';
}

function firstName(person) {
  return personName(person).split(/\s+/)[0];
}

function years(person) {
  const birth = person?.birth_date?.slice?.(0, 4);
  const death = person?.death_date?.slice?.(0, 4);
  if (birth && death) return `${birth}–${death}`;
  if (birth) return `b. ${birth}`;
  return 'Dates unknown';
}

function linkKey(a, b, type) {
  return `${type}:${[a, b].sort().join(':')}`;
}

function curve(a, b, type) {
  if (type === 'partner') return `M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y - 12}, ${(a.x + b.x) / 2} ${b.y - 12}, ${b.x} ${b.y}`;
  const midY = a.y + (b.y - a.y) * 0.55;
  return `M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`;
}

function focusPaths(graph, focusIds, positions) {
  const paths = [];
  const seenPartners = new Set();
  const parentGroups = new Map();

  for (const rel of graph.relationships) {
    const a = rel.from_person;
    const b = rel.to_person;
    if (!focusIds.has(a) || !focusIds.has(b) || !positions.has(a) || !positions.has(b)) continue;
    if (rel.type === 'partner') {
      const key = linkKey(a, b, 'partner');
      if (seenPartners.has(key)) continue;
      seenPartners.add(key);
      paths.push({ key, d: curve(positions.get(a), positions.get(b), 'partner'), type: 'partner', former: rel.partner_status === 'former' });
    }
  }

  // Parent connectors are composed by shared parent set. A family leaves its
  // parental unit through one calm trunk, then branches to siblings, rather
  // than becoming a web of crossing parent→child diagonals.
  for (const person of graph.people) {
    if (!focusIds.has(person.id) || !positions.has(person.id)) continue;
    const parents = graph.parents(person.id).map((x) => x.id).filter((id) => focusIds.has(id) && positions.has(id)).sort();
    if (!parents.length) continue;
    const key = parents.join('|');
    if (!parentGroups.has(key)) parentGroups.set(key, { parents, children: [] });
    parentGroups.get(key).children.push(person.id);
  }

  for (const [groupKey, group] of parentGroups) {
    const parentPoints = group.parents.map((id) => positions.get(id));
    const children = group.children.map((id) => positions.get(id)).sort((a, b) => a.x - b.x);
    const start = {
      x: parentPoints.reduce((sum, point) => sum + point.x, 0) / parentPoints.length,
      y: Math.max(...parentPoints.map((point) => point.y)) + 34,
    };
    const firstChildY = Math.min(...children.map((child) => child.y)) - 34;
    const junction = {
      x: children.reduce((sum, child) => sum + child.x, 0) / children.length,
      y: start.y + (firstChildY - start.y) * 0.68,
    };
    paths.push({
      key: `parent-stem:${groupKey}`,
      d: `M ${start.x} ${start.y} C ${start.x} ${junction.y}, ${junction.x} ${junction.y}, ${junction.x} ${junction.y}`,
      type: 'parent',
    });
    children.forEach((child, index) => paths.push({
      key: `parent-branch:${groupKey}:${index}`,
      d: `M ${junction.x} ${junction.y} C ${junction.x} ${child.y - 48}, ${child.x} ${child.y - 48}, ${child.x} ${child.y - 30}`,
      type: 'parent',
    }));
  }

  return paths;
}

function AtlasMark() {
  return (
    <svg viewBox="0 0 42 40" aria-hidden="true">
      <circle cx="13.9" cy="16.5" r="11.8" fill="#c2603a" />
      <circle cx="28.1" cy="16.5" r="11.8" fill="#3f5e4e" />
      <circle cx="21" cy="30.6" r="7.8" fill="#c4913f" />
    </svg>
  );
}

function buildClouds(graph, model) {
  const groups = new Map();
  for (const person of graph.people) {
    const point = model.positions.get(person.id);
    if (!point) continue;
    if (!groups.has(point.surname)) groups.set(point.surname, []);
    groups.get(point.surname).push(point);
  }
  return [...groups.entries()].map(([surname, points]) => {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return {
      surname,
      count: points.length,
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      rx: Math.max(38, (maxX - minX) / 2 + 26),
      ry: Math.max(56, (maxY - minY) / 2 + 24),
    };
  });
}

export default function LivingAtlasLab() {
  const stageRef = useRef(null);
  const viewport = useViewport(stageRef);
  const [fixtureId, setFixtureId] = useState('seed-family');
  const [source, setSource] = useState(() => fixtureById('seed-family'));
  const [activeId, setActiveId] = useState(() => fixtureById('seed-family').focus);
  const [phase, setPhase] = useState('settled');
  const [showAtlas, setShowAtlas] = useState(true);
  const [loadState, setLoadState] = useState('idle');
  const fileRef = useRef(null);

  const graph = useMemo(() => buildGraph(source.people, source.relationships), [source]);
  const model = useMemo(() => createAtlasModel(graph, activeId, viewport), [graph, activeId, viewport]);
  const links = useMemo(() => focusPaths(graph, model.focusIds, model.focusPositions), [graph, model]);
  const clouds = useMemo(() => buildClouds(graph, model), [graph, model]);
  // Preserve one SVG identity per person while ensuring the family stage is
  // always painted above the atlas. React keeps the keyed groups alive as a
  // person is promoted from context to focus, so the gather motion remains a
  // continuous transition rather than a duplicate or a jump cut.
  const orderedPeople = useMemo(() => [
    ...graph.people.filter((person) => !model.focusIds.has(person.id)),
    ...graph.people.filter((person) => model.focusIds.has(person.id)),
  ], [graph.people, model.focusIds]);
  const active = graph.byId.get(activeId);

  useEffect(() => {
    if (phase !== 'gathering') return undefined;
    const timer = setTimeout(() => setPhase('settled'), 1150);
    return () => clearTimeout(timer);
  }, [phase, activeId]);

  const choosePerson = (id) => {
    if (id === activeId) return;
    setPhase('gathering');
    setActiveId(id);
  };

  const chooseFixture = (id) => {
    const next = fixtureById(id);
    setFixtureId(id);
    setSource(next);
    setActiveId(next.focus);
    setLoadState('idle');
    setPhase('gathering');
  };

  const loadGedcom = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setLoadState('That GEDCOM is over the 25 MB prototype limit.');
      return;
    }
    setLoadState('loading');
    try {
      const parsed = gedcomToStore(await file.text());
      if (!parsed.people?.length) throw new Error('No people were found in that GEDCOM.');
      const focus = parsed.people[0].id;
      setSource({
        people: parsed.people,
        relationships: parsed.relationships || [],
        focus,
        id: 'local-gedcom',
        label: `${file.name} · local only`,
      });
      setFixtureId('local-gedcom');
      setActiveId(focus);
      // Dense archives should begin as atmosphere, not a wall of points. The
      // owner can still bring the complete atlas forward with one tap.
      setShowAtlas(parsed.people.length <= 250);
      setLoadState('loaded');
      setPhase('gathering');
    } catch (error) {
      setLoadState(error.message || 'That GEDCOM could not be read.');
    }
  };

  return (
    <main className={`atlas-lab atlas-lab--${phase} ${showAtlas ? '' : 'atlas-lab--quiet'} ${graph.people.length > 250 ? 'atlas-lab--dense' : ''}`}>
      <header className="atlas-lab__header">
        <div className="atlas-lab__brand"><AtlasMark /><div><strong>Living Atlas</strong><span>Concept prototype · read only</span></div></div>
        <div className="atlas-lab__controls">
          <label>
            <span>Family shape</span>
            <select value={fixtureId} onChange={(event) => chooseFixture(event.target.value)} disabled={fixtureId === 'local-gedcom'}>
              {FIXTURES.map((fixture) => <option value={fixture.id} key={fixture.id}>{fixture.label}</option>)}
              {fixtureId === 'local-gedcom' && <option value="local-gedcom">{source.label}</option>}
            </select>
          </label>
          <button className="atlas-lab__toggle" type="button" aria-pressed={showAtlas} onClick={() => setShowAtlas((value) => !value)}>
            {showAtlas ? 'Atlas visible' : 'Atlas quiet'}
          </button>
          <input ref={fileRef} className="atlas-lab__file" type="file" accept=".ged,.gedcom,text/plain" onChange={loadGedcom} />
          <button className="atlas-lab__load" type="button" onClick={() => fileRef.current?.click()} disabled={loadState === 'loading'}>
            {loadState === 'loading' ? 'Reading locally…' : 'Open GEDCOM · stays on device'}
          </button>
        </div>
      </header>

      <section className="atlas-lab__stage" ref={stageRef} aria-label="Living Family Atlas prototype">
        <div className="atlas-lab__title">
          <span>Family stage</span>
          <h1>{personName(active)}’s neighbourhood</h1>
          <p>{Math.max(0, model.focusIds.size - 1)} relatives gathered from {graph.people.length.toLocaleString()} in the atlas</p>
        </div>

        <svg className="atlas-lab__canvas" width={viewport.width} height={viewport.height} viewBox={`0 0 ${viewport.width} ${viewport.height}`}>
          <defs>
            <radialGradient id="atlas-stage-glow">
              <stop offset="0" stopColor="#fffaf4" stopOpacity=".98" />
              <stop offset=".55" stopColor="#fffaf4" stopOpacity=".52" />
              <stop offset="1" stopColor="#fffaf4" stopOpacity="0" />
            </radialGradient>
          </defs>

          <ellipse className="atlas-stage-glow" cx={model.centre.x} cy={model.centre.y} rx={Math.min(viewport.width * .43, 520)} ry={model.mobile ? 310 : 340} />

          <g className="atlas-clouds" aria-hidden="true">
            {clouds.map((cloud) => (
              <g key={cloud.surname}>
                <ellipse cx={cloud.x} cy={cloud.y} rx={cloud.rx} ry={cloud.ry} />
                {cloud.count >= 3 && <text x={cloud.x} y={cloud.y - cloud.ry - 8}>{cloud.surname} · {cloud.count}</text>}
              </g>
            ))}
          </g>

          <g className="atlas-focus-links">
            {links.map((link) => <path key={link.key} d={link.d} className={`atlas-link atlas-link--${link.type} ${link.former ? 'atlas-link--former' : ''}`} />)}
          </g>

          <g className="atlas-people">
            {orderedPeople.map((person) => {
              const atlas = model.positions.get(person.id);
              const focused = model.focusIds.has(person.id) && model.focusPositions.has(person.id);
              const target = focused ? model.focusPositions.get(person.id) : atlas;
              if (!target) return null;
              const colors = monogramColors(personName(person));
              const role = focused ? target.role : 'atlas';
              const radius = focused ? (person.id === activeId ? 42 : role === 'context' ? 24 : 30) : graph.people.length > 250 ? 2.4 : 3.5;
              const outside = model.outside.get(person.id);
              return (
                <g
                  className={`atlas-person atlas-person--${role} ${person.id === activeId ? 'atlas-person--active' : ''}`}
                  key={person.id}
                  style={{ '--atlas-x': `${target.x}px`, '--atlas-y': `${target.y}px`, '--atlas-delay': `${Math.min(target.priority || 0, 4) * 45}ms` }}
                  onClick={() => choosePerson(person.id)}
                  role="button"
                  tabIndex={focused ? 0 : -1}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') choosePerson(person.id); }}
                  aria-label={`Focus ${personName(person)}`}
                >
                  <circle className="atlas-person__halo" r={radius + (person.id === activeId ? 13 : 7)} />
                  <circle className="atlas-person__disc" r={radius} fill={colors.base} />
                  <circle className="atlas-person__shine" r={radius - 3} fill="none" stroke={colors.light} />
                  {focused && <text className="atlas-person__initials" y="1">{initials(personName(person))}</text>}
                  {focused && (
                    <g className="atlas-person__label" transform={`translate(0 ${radius + 17})`}>
                      <text className="atlas-person__name">{person.id === activeId ? personName(person) : firstName(person)}</text>
                      <text className="atlas-person__years" y="16">{person.id === activeId ? years(person) : role}</text>
                    </g>
                  )}
                  {focused && outside > 0 && (
                    <g className="atlas-person__portal" transform={`translate(${radius * .72} ${-radius * .72})`}>
                      <circle r="11" /><text y="1">+{outside}</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        <aside className="atlas-lab__legend">
          <span><i className="atlas-lab__legend-focus" />Family stage</span>
          <span><i className="atlas-lab__legend-context" />Wider family atlas</span>
          <span>Choose any portrait to gather their neighbourhood</span>
        </aside>
        {typeof loadState === 'string' && !['idle', 'loading', 'loaded'].includes(loadState) && <p className="atlas-lab__error">{loadState}</p>}
      </section>
    </main>
  );
}
