import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGraph } from '../../data/graph.js';
import { initials, monogramColors } from '../../lib/color.js';
import { gedcomToStore } from '../../lib/gedcom.js';
import { FIXTURES, fixtureById } from '../v2/fixtures.js';
import {
  branchGroups,
  cameraForScene,
  createLivingScene,
  recomposeLivingScene,
  siblingsFor,
} from './model.js';
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

function focusPaths(graph, focusIds, positions, spotlightIds) {
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
      paths.push({
        key,
        d: curve(positions.get(a), positions.get(b), 'partner'),
        type: 'partner',
        former: rel.partner_status === 'former',
        contextual: !spotlightIds.has(a) || !spotlightIds.has(b),
      });
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
    const children = group.children
      .map((id) => ({ id, point: positions.get(id) }))
      .sort((a, b) => a.point.x - b.point.x);
    const start = {
      x: parentPoints.reduce((sum, point) => sum + point.x, 0) / parentPoints.length,
      y: Math.max(...parentPoints.map((point) => point.y)) + 34,
    };
    const firstChildY = Math.min(...children.map((child) => child.point.y)) - 34;
    const junction = {
      x: children.reduce((sum, child) => sum + child.point.x, 0) / children.length,
      y: start.y + (firstChildY - start.y) * 0.68,
    };
    paths.push({
      key: `parent-stem:${groupKey}`,
      d: `M ${start.x} ${start.y} C ${start.x} ${junction.y}, ${junction.x} ${junction.y}, ${junction.x} ${junction.y}`,
      type: 'parent',
      contextual: !group.parents.every((id) => spotlightIds.has(id)) || !group.children.some((id) => spotlightIds.has(id)),
    });
    children.forEach(({ id, point: child }, index) => paths.push({
      key: `parent-branch:${groupKey}:${index}`,
      d: `M ${junction.x} ${junction.y} C ${junction.x} ${child.y - 48}, ${child.x} ${child.y - 48}, ${child.x} ${child.y - 30}`,
      type: 'parent',
      contextual: !group.parents.every((id) => spotlightIds.has(id)) || !spotlightIds.has(id),
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

const BRANCH_ANGLES = {
  parent: -90,
  partner: 0,
  child: 90,
  sibling: 180,
  'step-sibling': 140,
};

function branchBudLayout(branches, selectedPoint, positions) {
  if (!selectedPoint) return [];
  const occupied = [...positions.values()].filter((point) => point !== selectedPoint);
  const placed = [];
  return branches.map((branch) => {
    const preferred = BRANCH_ANGLES[branch.type] ?? 0;
    const angles = [preferred, preferred - 42, preferred + 42, preferred - 84, preferred + 84, preferred + 180];
    const candidates = [104, 136, 168, 196].flatMap((distance) => angles.map((angle, preference) => {
      const radians = angle * Math.PI / 180;
      const offset = { x: Math.cos(radians) * distance, y: Math.sin(radians) * distance };
      let score = (distance - 100) * 20 + preference * 80;
      for (const point of occupied) {
        const relative = { x: point.x - selectedPoint.x, y: point.y - selectedPoint.y };
        const overlapX = 88 - Math.abs(offset.x - relative.x);
        const overlapY = 72 - Math.abs(offset.y - relative.y);
        if (overlapX > 0 && overlapY > 0) score += 1_000_000 + overlapX * overlapY;
        const lengthSquared = offset.x ** 2 + offset.y ** 2;
        const along = Math.max(0, Math.min(1, (relative.x * offset.x + relative.y * offset.y) / lengthSquared));
        const nearest = { x: offset.x * along, y: offset.y * along };
        const stemDistance = Math.hypot(relative.x - nearest.x, relative.y - nearest.y);
        if (along > .18 && along < .9 && stemDistance < 42) score += 750_000 + (42 - stemDistance) * 100;
      }
      for (const point of placed) {
        const overlapX = 104 - Math.abs(offset.x - point.x);
        const overlapY = 50 - Math.abs(offset.y - point.y);
        if (overlapX > 0 && overlapY > 0) score += 1_000_000 + overlapX * overlapY;
      }
      return { ...offset, angle: radians, score };
    }));
    const choice = candidates.sort((a, b) => a.score - b.score)[0];
    placed.push(choice);
    return { ...branch, ...choice };
  });
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
  const [selectionHistory, setSelectionHistory] = useState(() => [fixtureById('seed-family').focus]);
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
  const stageScene = useMemo(
    () => recomposeLivingScene(graph, scene, selectedId, viewport),
    [graph, scene, selectedId, viewport],
  );
  const stagePositions = stageScene.scenePositions;
  const portraitIds = stageScene.portraitIds;
  const selected = graph.byId.get(selectedId);
  const lastExpansion = expansions.at(-1);
  const spotlightIds = useMemo(() => {
    const ids = new Set(portraitIds);
    if (lastExpansion?.anchorId === selectedId) scene.newestIds.forEach((id) => ids.add(id));
    return ids;
  }, [portraitIds, scene, selectedId, lastExpansion?.anchorId]);
  const links = useMemo(
    () => focusPaths(graph, scene.visibleIds, stagePositions, spotlightIds),
    [graph, scene.visibleIds, stagePositions, spotlightIds],
  );
  const clouds = useMemo(() => buildClouds(graph, scene), [graph, scene]);
  const branches = useMemo(() => branchGroups(graph, selectedId, scene.visibleIds), [graph, selectedId, scene.visibleIds]);
  const branchBuds = useMemo(
    () => branchBudLayout(branches, stagePositions.get(selectedId), stagePositions),
    [branches, stagePositions, selectedId],
  );
  const selectedPoint = stagePositions.get(selectedId);
  const spotlightPoints = [...spotlightIds].map((id) => stagePositions.get(id)).filter(Boolean);
  const expansionIsCurrent = scene.newestIds.length && lastExpansion?.anchorId === selectedId;
  const cameraAnchors = expansionIsCurrent
    ? [lastExpansion.anchorId, ...scene.newestIds]
    : branchBuds.length
      ? [...spotlightPoints, ...branchBuds.map((bud) => ({ x: selectedPoint.x + bud.x, y: selectedPoint.y + bud.y }))]
      : spotlightPoints.length ? spotlightPoints : [selectedId];
  const autoCamera = cameraForScene(stageScene, viewport, cameraAnchors);

  useEffect(() => {
    if (phase !== 'gathering') return undefined;
    const timer = setTimeout(() => setPhase('settled'), 1150);
    return () => clearTimeout(timer);
  }, [phase, selectedId, expansions.length]);

  const choosePerson = (id) => {
    if (id === selectedId) {
      setManualPan({ x: 0, y: 0 });
      return;
    }
    setSelectionHistory((current) => current.at(-1) === id ? current : [...current, id]);
    setSelectedId(id);
    setManualPan({ x: 0, y: 0 });
    setPhase('gathering');
  };

  const expandBranch = (type) => {
    setExpansions((current) => [...current, { anchorId: selectedId, type, sequence: current.length }]);
    setManualPan({ x: 0, y: 0 });
    setPhase('gathering');
  };

  const goBack = () => {
    if (selectionHistory.length > 1) {
      const nextHistory = selectionHistory.slice(0, -1);
      setSelectionHistory(nextHistory);
      setSelectedId(nextHistory.at(-1));
      setManualPan({ x: 0, y: 0 });
      setPhase('gathering');
      return;
    }
    if (!expansions.length) return;
    const previousAnchor = expansions.at(-1)?.anchorId || rootId;
    const next = expansions.slice(0, -1);
    setExpansions(next);
    setSelectedId(previousAnchor);
    setSelectionHistory([previousAnchor]);
    setManualPan({ x: 0, y: 0 });
    setPhase('gathering');
  };

  const goHome = () => {
    setExpansions([]);
    setSelectedId(rootId);
    setSelectionHistory([rootId]);
    setManualPan({ x: 0, y: 0 });
    setPhase('gathering');
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
    setSelectionHistory([next.focus]);
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
      setSelectionHistory([focus]);
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
            <select aria-label="Family shape" value={fixtureId} onChange={(event) => chooseFixture(event.target.value)} disabled={fixtureId === 'local-gedcom'}>
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
          <span>Family portrait</span>
          <h1>{personName(selected)}’s family</h1>
          <p>{portraitIds.size.toLocaleString()} gathered · {scene.visibleIds.size.toLocaleString()} explored · {graph.people.length.toLocaleString()} in the atlas</p>
        </div>

        {(expansions.length > 0 || selectedId !== rootId) && (
          <nav className="atlas-scene-nav" aria-label="Family canvas history">
            <button type="button" onClick={goBack} disabled={selectionHistory.length <= 1 && !expansions.length}>← Back</button>
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
              {links.map((link) => <path key={link.key} d={link.d} className={`atlas-link atlas-link--${link.type} ${link.former ? 'atlas-link--former' : ''} ${link.contextual ? 'atlas-link--contextual' : ''}`} />)}
            </g>

            <g className="atlas-people">
            {[...scene.visibleIds]
              .sort((a, b) => Number(spotlightIds.has(a)) - Number(spotlightIds.has(b)))
              .map((id) => {
              const person = graph.byId.get(id);
              const target = stagePositions.get(id);
              if (!person || !target) return null;
              const colors = monogramColors(personName(person));
              const role = target.role;
              const isSelected = person.id === selectedId;
              const radius = isSelected ? 42 : role === 'context' ? 24 : 30;
              const primary = isSelected ? personName(person) : firstName(person);
              const secondary = isSelected ? years(person) : relationshipLabel(graph, target.anchorId || rootId, person, role);
              const labelWidth = Math.min(162, Math.max(58, primary.length * (isSelected ? 7.2 : 6.4) + 22, secondary.length * 5.6 + 20));
              // The selected person's nameplate owns the centre-bottom of the
              // portrait. Partner labels sit above their discs so a horizontal
              // family pod reads as one composed unit instead of three cards
              // competing for the same baseline.
              const labelY = role === 'partner' ? -(radius + 19) : radius + 17;
              const isContextual = !spotlightIds.has(person.id);
              return (
                <g
                  className={`atlas-person atlas-person--${role} ${target.staged ? 'atlas-person--staged' : ''} ${isSelected ? 'atlas-person--active' : ''} ${isContextual ? 'atlas-person--contextual' : ''} ${target.expanded ? 'atlas-person--expanded' : ''}`}
                  key={person.id}
                  style={{ '--atlas-x': `${target.x}px`, '--atlas-y': `${target.y}px`, '--atlas-delay': `${Math.min(target.priority || 0, 4) * 45}ms` }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); choosePerson(person.id); }}
                  role="button"
                  tabIndex="0"
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') choosePerson(person.id); }}
                  aria-label={`Select ${personName(person)}`}
                >
                  <circle className="atlas-person__target" r="23" />
                  <circle className="atlas-person__halo" r={radius + (isSelected ? 13 : 7)} />
                  <circle className="atlas-person__disc" r={radius} fill={colors.base} />
                  <circle className="atlas-person__shine" r={radius - 3} fill="none" stroke={colors.light} />
                  <text className="atlas-person__initials" y="1">{initials(personName(person))}</text>
                  <g className="atlas-person__label" transform={`translate(0 ${labelY})`}>
                    <rect x={-labelWidth / 2} y="-11" width={labelWidth} height="32" rx="9" />
                    <text className="atlas-person__name" y="1">{primary}</text>
                    <text className="atlas-person__years" y="15">{secondary}</text>
                  </g>
                </g>
              );
            })}
            </g>

            {branchBuds.length > 0 && (() => {
              const selectedPoint = stagePositions.get(selectedId);
              return (
                <g className="atlas-branch-buds" transform={`translate(${selectedPoint.x} ${selectedPoint.y})`}>
                  {branchBuds.map((branch) => {
                    const width = Math.min(106, Math.max(76, branch.label.length * 5.6 + 38));
                    const stemStart = { x: Math.cos(branch.angle) * 56, y: Math.sin(branch.angle) * 56 };
                    return (
                      <g className="atlas-branch-bud-wrap" key={branch.type}>
                        <line className="atlas-branch-bud-stem" x1={stemStart.x} y1={stemStart.y} x2={branch.x} y2={branch.y} />
                        <g
                          className={`atlas-branch-bud atlas-branch-bud--${branch.type}`}
                          transform={`translate(${branch.x} ${branch.y})`}
                          role="button"
                          tabIndex="0"
                          aria-label={`Show ${branch.ids.length} ${branch.label.toLowerCase()} for ${personName(selected)}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => { event.stopPropagation(); expandBranch(branch.type); }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              expandBranch(branch.type);
                            }
                          }}
                        >
                          <rect className="atlas-branch-bud__target" x={-width / 2} y="-22" width={width} height="44" rx="22" />
                          <rect className="atlas-branch-bud__surface" x={-width / 2} y="-17" width={width} height="34" rx="17" />
                          <circle cx={-width / 2 + 16} r="9" />
                          <text className="atlas-branch-bud__count" x={-width / 2 + 16} y="1">+{branch.ids.length}</text>
                          <text className="atlas-branch-bud__label" x={-width / 2 + 31} y="1">{branch.label}</text>
                        </g>
                      </g>
                    );
                  })}
                </g>
              );
            })()}
          </g>
        </svg>
        {typeof loadState === 'string' && !['idle', 'loading', 'loaded'].includes(loadState) && <p className="atlas-lab__error">{loadState}</p>}
      </section>
    </main>
  );
}
