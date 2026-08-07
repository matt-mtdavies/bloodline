import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { buildGraph } from '../../data/graph.js';
import { FIXTURES, fixtureById } from './fixtures.js';
import { createMotionEngine } from './engine.js';
import { createLegacyEngine } from './legacyEngine.js';
import { treePhysicsVersion, setStoredPhysicsVersion, PHYSICS_PARAM } from '../../lib/treePhysicsFlag.js';
import { ROW_GAP } from './layoutPlanner.js';
import { monogramColors, initials } from '../../lib/color.js';
import './lab.css';

/*
 * Visual language borrowed from the REAL renderer (src/viz/bubble.js,
 * src/viz/links.js) — a validation pass, not a redesign: the first version
 * of this lab was intentionally bare (flat grey circles, straight lines, no
 * color) because it existed only to prove POSITIONS and MOTION were
 * correct. Once that was proven, a real product-feel question came up
 * ("V2 doesn't look very fluid") that a bare bench can't honestly answer —
 * so this pass borrows the actual monogram-color/curved-link language
 * production already uses, so the lab can be judged on equal footing.
 *
 * JITTER_AMPLITUDE is the one genuinely new idea here, not a port: V2's row
 * assignment is exact (every person in a generation sits on precisely the
 * same y — that precision is the whole point of the P1/P2 work, and stays
 * completely unchanged). A small, deterministic per-person offset is
 * layered on TOP of that exact position purely for rendering — the same
 * pattern ambient breathing already uses (see engine.js's worldPositions())
 * — so a row reads as a family standing together, not a spreadsheet, without
 * touching a single number the layout/collision/camera math depends on.
 */
const JITTER_AMPLITUDE = 6; // px at zoom 1 — small on purpose; this is texture, not re-layout

function hashId(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function jitterFor(id, zoom) {
  const h = hashId(id);
  const jx = ((h % 1000) / 1000 - 0.5) * 2 * JITTER_AMPLITUDE * zoom;
  const jy = (((h >>> 10) % 1000) / 1000 - 0.5) * 2 * JITTER_AMPLITUDE * zoom;
  return { x: jx, y: jy };
}

// A gentle quadratic sag, like a hanging cord — identical shape to
// src/viz/links.js's own curve()/dashedCurve(), just emitted as an SVG path
// instead of a Pixi Graphics call.
function sagPath(a, b) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + Math.abs(a.x - b.x) * 0.06;
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
}

const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive';

/*
 * Parent→child links, merged at the co-parent level exactly like
 * links.js's own `groups`/`divorceGroups` pass: two co-parents (current OR
 * former partners) share one visual origin rather than each drawing an
 * independent line, and 2+ children under one couple share a single
 * stem→junction→branches trunk instead of a fan of lines all leaving the
 * same point. `renderPos(id)` already includes the organic jitter, so the
 * curves visually terminate exactly on the (slightly offset) bubble.
 */
function buildParentChildLinks(graph, renderPos, nodeR) {
  const links = []; // { path, biological, former }
  const merged = new Set();
  const groups = new Map();
  const divorceGroups = new Map();

  for (const person of graph.people) {
    const childId = person.id;
    const parents = graph.parents(childId);
    if (parents.length < 2) continue;
    for (let i = 0; i < parents.length; i++) {
      for (let j = i + 1; j < parents.length; j++) {
        const p1 = parents[i], p2 = parents[j];
        if (p1.qualifier !== p2.qualifier) continue;
        const bond = graph.partners(p1.id).find((x) => x.id === p2.id);
        if (!bond) continue;
        const key = `${[p1.id, p2.id].sort().join('|')}|${p1.qualifier}`;
        const target = bond.status === 'former' ? divorceGroups : groups;
        if (!target.has(key)) target.set(key, { p1: p1.id, p2: p2.id, qualifier: p1.qualifier, kids: [], former: bond.status === 'former' });
        target.get(key).kids.push(childId);
        merged.add(`${p1.id}>${childId}`);
        merged.add(`${p2.id}>${childId}`);
      }
    }
  }

  const drawGroup = (grp) => {
    const a1 = renderPos(grp.p1), a2 = renderPos(grp.p2);
    if (!a1 || !a2) return;
    const biological = isBioAdopt(grp.qualifier);
    const start = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 + nodeR * 1.05 };
    const kidEntries = grp.kids.map((id) => ({ id, p: renderPos(id) })).filter((e) => e.p);
    if (!kidEntries.length) return;
    const add = (a, b) => links.push({ path: sagPath(a, b), biological, former: grp.former });
    if (kidEntries.length === 1) {
      add(start, kidEntries[0].p);
    } else {
      const avgX = kidEntries.reduce((s, e) => s + e.p.x, 0) / kidEntries.length;
      const nearestY = Math.min(...kidEntries.map((e) => e.p.y));
      const junction = { x: start.x * 0.55 + avgX * 0.45, y: start.y + (nearestY - start.y) * 0.72 };
      add(start, junction);
      for (const e of kidEntries) add(junction, e.p);
    }
  };
  for (const grp of groups.values()) drawGroup(grp);
  for (const grp of divorceGroups.values()) drawGroup(grp);

  // Everyone else's direct, un-merged parent edges (single parent, or a
  // step/adoptive line that isn't part of a merged couple pod).
  for (const person of graph.people) {
    for (const parent of graph.parents(person.id)) {
      const key = `${parent.id}>${person.id}`;
      if (merged.has(key)) continue;
      const a = renderPos(parent.id), b = renderPos(person.id);
      if (!a || !b) continue;
      links.push({ path: sagPath(a, b), biological: isBioAdopt(parent.qualifier), former: false });
    }
  }
  return links;
}

/*
 * The Tree Motion Lab.
 *
 * A fixture-only bench for judging tree MOTION and COMPOSITION side by side.
 * Rendered as plain SVG rather than through the production PixiJS renderer, on
 * purpose: the question this lab exists to answer is "does the arrangement and
 * the movement read correctly", and SVG makes every node individually
 * inspectable by Playwright, screenshot-diffable, and free of any dependency on
 * the renderer we are not changing yet. Wiring V2 into Pixi is deliberately a
 * later step — this PR is the planner, the motion, and the evidence.
 *
 * Everything on screen is driven by the same engine objects the tests drive,
 * so the overlay's numbers are the numbers CI asserts on.
 */

const VIEWPORT = { width: 980, height: 620 };

export default function TreeMotionLab() {
  const [fixtureId, setFixtureId] = useState(FIXTURES[0].id);
  const [version, setVersion] = useState(treePhysicsVersion());
  const [showOverlay, setShowOverlay] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [ambient, setAmbient] = useState(true);
  const [summary, setSummary] = useState(null);
  const [, forceRender] = useState(0);

  const fixture = useMemo(() => fixtureById(fixtureId), [fixtureId]);
  const graph = useMemo(() => buildGraph(fixture.people, fixture.relationships), [fixture]);

  const engineRef = useRef(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const [activeId, setActiveId] = useState(fixture.focus);

  // Pan/pin state itself is declared here (needs to exist before the reset
  // effect below); the drag handlers that populate it are declared further
  // down, after the engine's camera/screen positions are available — see
  // the comment there for why both gestures exist and what each means.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [pins, setPins] = useState(new Map()); // personId -> {x, y} world
  const dragRef = useRef(null);
  const justDraggedRef = useRef(false);

  // Rebuild the engine whenever the experiment's inputs change.
  useEffect(() => {
    const engine = version === 'v2'
      ? createMotionEngine({ graph, viewport: VIEWPORT, ambient })
      : createLegacyEngine({ graph, viewport: VIEWPORT });
    engine.select(fixture.focus);
    engineRef.current = engine;
    setActiveId(fixture.focus);
    setSummary(null);
    setPan({ x: 0, y: 0 });
    setPins(new Map());
    lastTsRef.current = 0;
    return () => { engineRef.current = null; };
  }, [graph, version, ambient, fixture.focus]);

  // One animation loop, driving the engine with real wall-clock deltas.
  useEffect(() => {
    const tick = (ts) => {
      const engine = engineRef.current;
      if (engine) {
        const dt = lastTsRef.current ? ts - lastTsRef.current : 16.667;
        lastTsRef.current = ts;
        engine.step(dt);
        forceRender((n) => (n + 1) % 1000000);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const select = useCallback((id, screenPoint) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.resetMetrics(`select:${id}`);
    engine.select(id, screenPoint ? { anchor: screenPoint } : undefined);
    setActiveId(id);
    setSummary(null);
  }, []);

  // Publish the live engine for the capture harness and for manual poking in
  // devtools. Lab-only: nothing in the app reads this.
  useEffect(() => {
    window.__treeMotionLab = {
      select,
      setFixture: setFixtureId,
      setVersion: (v) => { setStoredPhysicsVersion(v); setVersion(v); },
      engine: () => engineRef.current,
      summary: () => engineRef.current?.summary() ?? null,
      isSettled: () => !!engineRef.current?.isSettled(),
      fixtures: FIXTURES.map((f) => ({ id: f.id, label: f.label, focus: f.focus })),
    };
    return () => { delete window.__treeMotionLab; };
  }, [select]);

  const engine = engineRef.current;
  const screen = engine ? engine.screenPositions() : new Map();
  const cam = engine ? engine.camera() : { zoom: 1, screenX: 0, screenY: 0, worldX: 0, worldY: 0 };
  const plan = engine?.plan ?? null;
  const nodeR = 30 * cam.zoom;

  // Two drag gestures, mirroring src/viz/BubbleTree.jsx's own drag.type
  // convention ('pan' vs 'bubble') on purpose — this is meant to feel like
  // the same interaction that already exists in production, not a new one:
  //   - drag empty canvas → pan (screen-space offset, render-only).
  //   - drag a bubble → that person's position becomes a PERSISTENT manual
  //     override ("pins", world-space), the same real behavior BubbleTree.jsx
  //     already has via d3-force's fx/fy: the planner's computed position is
  //     still what everyone ELSE (and this person, if the pin is cleared)
  //     uses — moving one person is a deliberate, sticky exception, not a
  //     change to what's "correct". The active person is intentionally not
  //     draggable this way — they're the camera's own anchor (world origin);
  //     "moving" them is what panning already means.
  // Pinch/wheel zoom is still intentionally NOT included — staying minimal.

  // The engine's raw, un-jittered/un-panned/un-pinned world position for a
  // person — inverts toScreen() using the CURRENT camera, since that's the
  // only place world coordinates are otherwise available from outside the
  // engine (camera.worldX/Y are always 0, world origin = the active person).
  const worldOfPerson = useCallback((id) => {
    const s = screen.get(id);
    if (!s) return { x: 0, y: 0 };
    return { x: (s.x - cam.screenX) / cam.zoom, y: (s.y - cam.screenY) / cam.zoom };
  }, [screen, cam.screenX, cam.screenY, cam.zoom]);

  const onStagePointerDown = useCallback((e) => {
    dragRef.current = { type: 'pan', startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pan]);
  const onBubblePointerDown = useCallback((e, personId) => {
    if (personId === activeId) return; // let it fall through to canvas pan
    e.stopPropagation();
    const startWorld = pins.get(personId) ?? worldOfPerson(personId);
    dragRef.current = { type: 'bubble', personId, startWorld, startX: e.clientX, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [activeId, pins, worldOfPerson]);
  const onStagePointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    if (!d.moved) return;
    if (d.type === 'pan') {
      setPan({ x: d.startPanX + dx, y: d.startPanY + dy });
    } else if (d.type === 'bubble') {
      const next = { x: d.startWorld.x + dx / cam.zoom, y: d.startWorld.y + dy / cam.zoom };
      setPins((prev) => new Map(prev).set(d.personId, next));
    }
  }, [cam.zoom]);
  const onStagePointerUp = useCallback(() => {
    if (dragRef.current?.moved) justDraggedRef.current = true;
    dragRef.current = null;
  }, []);

  // The organic-jitter render position every node AND every link endpoint
  // uses — see jitterFor()'s own comment. A manually pinned person (see
  // above) uses their pinned world position instead, converted through the
  // SAME camera every unpinned person uses, so a pin stays visually
  // consistent with everyone else through camera moves/zoom changes.
  // Falls back to the un-jittered screen position for anyone the engine
  // hasn't placed yet.
  const renderPos = useCallback((id) => {
    const pin = pins.get(id);
    if (pin) {
      return { x: cam.screenX + pin.x * cam.zoom + pan.x, y: cam.screenY + pin.y * cam.zoom + pan.y };
    }
    const s = screen.get(id);
    if (!s) return null;
    const j = jitterFor(id, cam.zoom);
    return { x: s.x + j.x + pan.x, y: s.y + j.y + pan.y };
  }, [screen, cam.zoom, cam.screenX, cam.screenY, pan, pins]);

  const partnerLinks = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const person of graph.people) {
      for (const pt of graph.partners(person.id)) {
        const key = [person.id, pt.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ a: person.id, b: pt.id, former: pt.status === 'former' });
      }
    }
    return out;
  }, [graph]);

  const parentChildLinks = useMemo(
    () => buildParentChildLinks(graph, renderPos, nodeR),
    [graph, renderPos, nodeR],
  );

  const live = engine?.metrics()?.summary?.() ?? null;

  return (
    <div className="lab">
      <header className="lab__bar">
        <strong className="lab__title">Tree Motion Lab</strong>
        <span className={`lab__engine lab__engine--${version}`}>{version.toUpperCase()}</span>

        <label className="lab__field">
          Fixture
          <select
            value={fixtureId}
            onChange={(e) => setFixtureId(e.target.value)}
            data-testid="fixture-select"
          >
            {FIXTURES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>

        <div className="lab__seg" role="group" aria-label="Physics engine">
          {['v1', 'v2'].map((v) => (
            <button
              key={v}
              data-testid={`engine-${v}`}
              className={version === v ? 'is-on' : ''}
              onClick={() => { setStoredPhysicsVersion(v); setVersion(v); }}
            >
              {v === 'v1' ? 'V1 production forces' : 'V2 planned + springs'}
            </button>
          ))}
        </div>

        <label className="lab__check">
          <input type="checkbox" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} /> Overlay
        </label>
        <label className="lab__check">
          <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} /> Guides
        </label>
        <label className="lab__check">
          <input type="checkbox" checked={ambient} onChange={(e) => setAmbient(e.target.checked)} /> Breathing
        </label>
        <button
          className="lab__btn"
          data-testid="capture-summary"
          onClick={() => setSummary(engineRef.current?.summary() ?? null)}
        >
          Snapshot metrics
        </button>
      </header>

      <p className="lab__note">{fixture.note}</p>

      <div className="lab__stage" style={{ width: VIEWPORT.width, height: VIEWPORT.height }}>
        <svg
          width={VIEWPORT.width} height={VIEWPORT.height} data-testid="lab-stage"
          className="lab__svg"
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
          onPointerCancel={onStagePointerUp}
        >
          {showGuides && plan && [...new Set([...plan.rows.values()])].sort((a, b) => a - b).map((r) => {
            const y = cam.screenY + (r * ROW_GAP - cam.worldY) * cam.zoom + pan.y;
            return (
              <g key={r}>
                <line x1={0} x2={VIEWPORT.width} y1={y} y2={y} className="lab__rowline" />
                <text x={6} y={y - 4} className="lab__rowlabel">row {r}</text>
              </g>
            );
          })}

          {/* Partner bond — a soft warm band for current partnerships, a
              faded dashed line for former ones, matching links.js's own
              "current reads warm and solid, former is a faded dashed bond"
              language. */}
          {partnerLinks.map(({ a: aId, b: bId, former }, i) => {
            const a = renderPos(aId), b = renderPos(bId);
            if (!a || !b) return null;
            return (
              <line
                key={`p${i}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                className={`lab__edge lab__edge--partner${former ? ' is-former' : ''}`}
              />
            );
          })}

          {/* Parent→child links — merged at the couple level with a
              stem→junction→branches trunk for 2+ children, a gentle
              hanging-cord sag instead of a straight line, exactly like the
              real canvas (see buildParentChildLinks' own header). */}
          {parentChildLinks.map((link, i) => (
            <path
              key={`c${i}`}
              d={link.path}
              className={`lab__edge lab__edge--child${link.biological ? '' : ' is-nonbio'}${link.former ? ' is-former' : ''}`}
            />
          ))}

          {graph.people.map((p) => {
            const s = screen.get(p.id);
            const rp = renderPos(p.id);
            if (!s || !rp) return null;
            const isActive = p.id === activeId;
            const isNear = plan?.nearIds?.has(p.id);
            const { base } = monogramColors(p.display_name);
            return (
              <g
                key={p.id}
                data-testid={`node-${p.id}`}
                data-person={p.id}
                data-x={s.x.toFixed(3)}
                data-y={s.y.toFixed(3)}
                className={`lab__node${isActive ? ' is-active' : ''}${isNear ? ' is-near' : ''}${p.is_deceased ? ' is-deceased' : ''}${pins.has(p.id) ? ' is-pinned' : ''}`}
                onPointerDown={(e) => onBubblePointerDown(e, p.id)}
                onClick={() => {
                  if (justDraggedRef.current) { justDraggedRef.current = false; return; }
                  select(p.id, s);
                }}
              >
                {p.is_deceased && (
                  <circle className="lab__node-memring" cx={rp.x} cy={rp.y} r={nodeR + 4} />
                )}
                <circle
                  className="lab__node-fill"
                  cx={rp.x} cy={rp.y} r={nodeR}
                  style={{ fill: base }}
                />
                {isActive && (
                  <circle className="lab__node-activering" cx={rp.x} cy={rp.y} r={nodeR + 2.5} />
                )}
                <text x={rp.x} y={rp.y + nodeR * 0.11} className="lab__initials">{initials(p.display_name)}</text>
                <text x={rp.x} y={rp.y + nodeR + 16} className="lab__name">{p.display_name}</text>
              </g>
            );
          })}
        </svg>

        {showOverlay && (
          <div className="lab__overlay" data-testid="lab-overlay">
            <Row k="engine" v={version} />
            <Row k="active" v={graph.byId.get(activeId)?.display_name ?? '—'} />
            <Row k="settled" v={engine?.isSettled() ? 'yes' : 'no'} testid="ov-settled" />
            <Row k="unsettled nodes" v={live ? String(live.frames && lastUnsettled(engine)) : '—'} />
            <Row k="zoom" v={cam.zoom.toFixed(3)} />
            <Row k="settle ms" v={live?.settleMs ?? '—'} testid="ov-settle-ms" />
            <Row k="peak speed" v={live ? `${live.peakSpeed}/s` : '—'} />
            <Row k="active drift (max px)" v={live?.maxActiveDriftPx ?? '—'} testid="ov-active-drift" />
            <Row k="active drift (total px)" v={live?.totalActiveDriftPx ?? '—'} />
            <Row k="rebound frames" v={live?.reboundFrames ?? '—'} testid="ov-rebound" />
            <Row k="max collision push" v={live?.maxCollisionPush ?? '—'} />
            <Row k="selection-boundary jump (px)" v={live?.selectionBoundaryJumpPx ?? '—'} testid="ov-boundary-jump" />
            <Row k="max node move/frame (px)" v={live?.maxNodeDisplacementPx ?? '—'} testid="ov-node-move" />
            <Row k="max acceleration" v={live?.maxAcceleration ?? '—'} />
            <Row k="direction reversals" v={live?.directionReversals ?? '—'} />
            <Row k="max collision push Δ" v={live?.maxCollisionPushDelta ?? '—'} />
            <Row k="max zoom velocity" v={live?.maxZoomVelocity ?? '—'} />
            {live && (
              <div className={`lab__verdict lab__verdict--${live.passed ? 'pass' : 'fail'}`} data-testid="ov-verdict">
                {live.passed ? '✓ within thresholds' : `✗ ${live.failures.length} threshold${live.failures.length === 1 ? '' : 's'} exceeded`}
              </div>
            )}
          </div>
        )}
      </div>

      {summary && (
        <pre className="lab__summary" data-testid="metrics-json">{JSON.stringify(summary, null, 2)}</pre>
      )}

      <footer className="lab__foot">
        Fixture-only. No family data is loaded here and nothing is written.
        Switch engines with <code>?{PHYSICS_PARAM}=v1</code> / <code>?{PHYSICS_PARAM}=v2</code>.
      </footer>
    </div>
  );
}

function lastUnsettled(engine) {
  const frames = engine?.metrics()?.frames;
  return frames?.length ? frames[frames.length - 1].unsettled : 0;
}

function Row({ k, v, testid }) {
  return (
    <div className="lab__ovrow">
      <span>{k}</span>
      <b data-testid={testid}>{String(v)}</b>
    </div>
  );
}
