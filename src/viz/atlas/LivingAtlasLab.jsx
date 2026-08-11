import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGraph } from '../../data/graph.js';
import { initials, monogramColors } from '../../lib/color.js';
import { gedcomToStore } from '../../lib/gedcom.js';
import { FIXTURES, fixtureById } from '../v2/fixtures.js';
import { branchGroups, cameraForScene, createLivingScene, siblingsFor } from './model.js';
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

function gendered(person, female, male, neutral) {
  if (person?.gender === 'female') return female;
  if (person?.gender === 'male') return male;
  return neutral;
}

function relationshipLabel(graph, anchorId, person, role) {
  if (role === 'active') return 'Home';
  if (role === 'parent') return gendered(person, 'Mother', 'Father', 'Parent');
  if (role === 'child') return gendered(person, 'Daughter', 'Son', 'Child');
  if (role === 'partner') {
    const edge = graph.partners(anchorId).find((entry) => entry.id === person.id);
    return edge?.status === 'former' ? 'Former partner' : 'Partner';
  }
  if (role === 'sibling') {
    const edge = siblingsFor(graph, anchorId).find((entry) => entry.id === person.id);
    const base = gendered(person, 'Sister', 'Brother', 'Sibling');
    if (edge?.kind === 'step') return `Step${base.toLowerCase()}`;
    if (edge?.kind === 'half') return `Half ${base.toLowerCase()}`;
    return base;
  }
  if (role === 'context') return 'Family branch';
  return role;
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
  const [rootId, setRootId] = useState(() => fixtureById('seed-family').focus);
  const [selectedId, setSelectedId] = useState(() => fixtureById('seed-family').focus);
  const [expansions, setExpansions] = useState([]);
  const [manualPan, setManualPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState('settled');
  const [showAtlas, setShowAtlas] = useState(true);
  const [loadState, setLoadState] = useState('idle');
  const fileRef = useRef(null);
  const dragRef = useRef(null);

  const graph = useMemo(() => buildGraph(source.people, source.relationships), [source]);
  const scene = useMemo(() => createLivingScene(graph, rootId, viewport, expansions), [graph, rootId, viewport, expansions]);
  const links = useMemo(() => focusPaths(graph, scene.visibleIds, scene.scenePositions), [graph, scene]);
  const clouds = useMemo(() => buildClouds(graph, scene), [graph, scene]);
  const branches = useMemo(() => branchGroups(graph, selectedId, scene.visibleIds), [graph, selectedId, scene.visibleIds]);
  const selected = graph.byId.get(selectedId);
  const lastExpansion = expansions.at(-1);
  const cameraAnchors = scene.newestIds.length && lastExpansion
    ? [lastExpansion.anchorId, ...scene.newestIds]
    : [selectedId];
  const autoCamera = useMemo(() => cameraForScene(scene, viewport, cameraAnchors), [scene, viewport, selectedId, expansions.length]);

  useEffect(() => {
    if (phase !== 'gathering') return undefined;
    const timer = setTimeout(() => setPhase('settled'), 1150);
    return () => clearTimeout(timer);
  }, [phase, selectedId, expansions.length]);

  const choosePerson = (id) => {
    setSelectedId(id);
    setManualPan({ x: 0, y: 0 });
  };

  const expandBranch = (type) => {
    setExpansions((current) => [...current, { anchorId: selectedId, type, sequence: current.length }]);
    setManualPan({ x: 0, y: 0 });
    setPhase('gathering');
  };

  const goBack = () => {
    const previousAnchor = expansions.at(-1)?.anchorId || rootId;
    const next = expansions.slice(0, -1);
    setExpansions(next);
    setSelectedId(previousAnchor);
    setManualPan({ x: 0, y: 0 });
  };

  const goHome = () => {
    setExpansions([]);
    setSelectedId(rootId);
    setManualPan({ x: 0, y: 0 });
  };

  const beginPan = (event) => {
    if (event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY, pan: manualPan };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const movePan = (event) => {
    if (!dragRef.current) return;
    setManualPan({
      x: dragRef.current.pan.x + event.clientX - dragRef.current.x,
      y: dragRef.current.pan.y + event.clientY - dragRef.current.y,
    });
  };

  const endPan = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const chooseFixture = (id) => {
    const next = fixtureById(id);
    setFixtureId(id);
    setSource(next);
    setRootId(next.focus);
    setSelectedId(next.focus);
    setExpansions([]);
    setManualPan({ x: 0, y: 0 });
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
      setRootId(focus);
      setSelectedId(focus);
      setExpansions([]);
      setManualPan({ x: 0, y: 0 });
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
    <main className={`atlas-lab atlas-lab--${phase} ${showAtlas ? '' : 'atlas-lab--quiet'} ${graph.people.length > 250 ? 'atlas-lab--dense' : ''} ${dragging ? 'atlas-lab--dragging' : ''}`}>
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
          <span>Living family</span>
          <h1>{personName(graph.byId.get(rootId))}’s family canvas</h1>
          <p>{scene.visibleIds.size.toLocaleString()} people in view · {graph.people.length.toLocaleString()} in the atlas</p>
        </div>

        {(expansions.length > 0 || selectedId !== rootId) && (
          <nav className="atlas-scene-nav" aria-label="Family canvas history">
            <button type="button" onClick={goBack} disabled={!expansions.length}>← Back</button>
            <button type="button" onClick={goHome}>⌂ Home</button>
            <span>Drag the canvas to explore</span>
          </nav>
        )}

        <svg
          className="atlas-lab__canvas"
          width={viewport.width}
          height={viewport.height}
          viewBox={`0 0 ${viewport.width} ${viewport.height}`}
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
          <defs>
            <radialGradient id="atlas-stage-glow">
              <stop offset="0" stopColor="#fffaf4" stopOpacity=".98" />
              <stop offset=".55" stopColor="#fffaf4" stopOpacity=".52" />
              <stop offset="1" stopColor="#fffaf4" stopOpacity="0" />
            </radialGradient>
          </defs>

          <ellipse className="atlas-stage-glow" cx={viewport.width / 2} cy={viewport.height / 2} rx={Math.min(viewport.width * .43, 520)} ry={scene.mobile ? 310 : 340} />

          <g className="atlas-clouds" aria-hidden="true">
            {clouds.map((cloud) => (
              <g key={cloud.surname}>
                <ellipse cx={cloud.x} cy={cloud.y} rx={cloud.rx} ry={cloud.ry} />
                {cloud.count >= 3 && <text x={cloud.x} y={cloud.y - cloud.ry - 8}>{cloud.surname} · {cloud.count}</text>}
              </g>
            ))}
          </g>

          <g
            className="atlas-world"
            style={{
              '--camera-x': `${viewport.width / 2 + autoCamera.x + manualPan.x}px`,
              '--camera-y': `${viewport.height / 2 + autoCamera.y + manualPan.y}px`,
              '--camera-scale': autoCamera.scale,
            }}
          >
            <g className="atlas-focus-links">
              {links.map((link) => <path key={link.key} d={link.d} className={`atlas-link atlas-link--${link.type} ${link.former ? 'atlas-link--former' : ''}`} />)}
            </g>

            <g className="atlas-people">
            {[...scene.visibleIds].map((id) => {
              const person = graph.byId.get(id);
              const target = scene.scenePositions.get(id);
              if (!person || !target) return null;
              const colors = monogramColors(personName(person));
              const role = target.role;
              const isSelected = person.id === selectedId;
              const radius = isSelected ? 42 : role === 'context' ? 24 : 30;
              const primary = isSelected ? personName(person) : firstName(person);
              const secondary = isSelected ? years(person) : relationshipLabel(graph, target.anchorId || rootId, person, role);
              const labelWidth = Math.min(162, Math.max(58, primary.length * (isSelected ? 7.2 : 6.4) + 22, secondary.length * 5.6 + 20));
              const labelY = role === 'partner' && !isSelected ? -(radius + 19) : radius + 17;
              return (
                <g
                  className={`atlas-person atlas-person--${role} ${isSelected ? 'atlas-person--active' : ''} ${target.expanded ? 'atlas-person--expanded' : ''}`}
                  key={person.id}
                  style={{ '--atlas-x': `${target.x}px`, '--atlas-y': `${target.y}px`, '--atlas-delay': `${Math.min(target.priority || 0, 4) * 45}ms` }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); choosePerson(person.id); }}
                  role="button"
                  tabIndex="0"
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') choosePerson(person.id); }}
                  aria-label={`Select ${personName(person)}`}
                >
                  <circle className="atlas-person__halo" r={radius + (isSelected ? 13 : 7)} />
                  <circle className="atlas-person__disc" r={radius} fill={colors.base} />
                  <circle className="atlas-person__shine" r={radius - 3} fill="none" stroke={colors.light} />
                  <text className="atlas-person__initials" y="1">{initials(personName(person))}</text>
                  <g className="atlas-person__label" transform={`translate(0 ${labelY})`}>
                    <rect x={-labelWidth / 2} y="-11" width={labelWidth} height="32" rx="9" />
                    <text className="atlas-person__name" y="1">{primary}</text>
                    <text className="atlas-person__years" y="15">{secondary}</text>
                  </g>
                  {isSelected && branches.length > 0 && (
                    <g className="atlas-person__portal" transform={`translate(${radius * .72} ${-radius * .72})`} aria-hidden="true">
                      <circle r="11" /><text y="1">+</text>
                    </g>
                  )}
                </g>
              );
            })}
            </g>
          </g>
        </svg>

        <nav className={`atlas-branch-dock ${branches.length ? '' : 'atlas-branch-dock--complete'}`} aria-label={`Expand ${personName(selected)}'s family`}>
          <div className="atlas-branch-dock__person"><strong>{firstName(selected)}</strong><span>{branches.length ? 'Choose a branch to grow' : 'Immediate family is open'}</span></div>
          <div className="atlas-branch-dock__actions">
            {branches.map((branch) => (
              <button type="button" key={branch.type} onClick={() => expandBranch(branch.type)}>
                <span>{branch.label}</span><b>{branch.ids.length}</b><i>→</i>
              </button>
            ))}
          </div>
        </nav>
        {typeof loadState === 'string' && !['idle', 'loading', 'loaded'].includes(loadState) && <p className="atlas-lab__error">{loadState}</p>}
      </section>
    </main>
  );
}
