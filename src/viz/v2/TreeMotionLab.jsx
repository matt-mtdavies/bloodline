import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { buildGraph } from '../../data/graph.js';
import { FIXTURES, fixtureById } from './fixtures.js';
import { createMotionEngine } from './engine.js';
import { createLegacyEngine } from './legacyEngine.js';
import { treePhysicsVersion, setStoredPhysicsVersion, PHYSICS_PARAM } from '../../lib/treePhysicsFlag.js';
import { ROW_GAP } from './layoutPlanner.js';
import './lab.css';

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

  // Rebuild the engine whenever the experiment's inputs change.
  useEffect(() => {
    const engine = version === 'v2'
      ? createMotionEngine({ graph, viewport: VIEWPORT, ambient })
      : createLegacyEngine({ graph, viewport: VIEWPORT });
    engine.select(fixture.focus);
    engineRef.current = engine;
    setActiveId(fixture.focus);
    setSummary(null);
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

  const edges = useMemo(() => graph.relationships.filter(
    (r) => (r.type === 'parent' || r.type === 'partner'),
  ), [graph]);

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
        <svg width={VIEWPORT.width} height={VIEWPORT.height} data-testid="lab-stage">
          {showGuides && plan && [...new Set([...plan.rows.values()])].sort((a, b) => a - b).map((r) => {
            const y = cam.screenY + (r * ROW_GAP - cam.worldY) * cam.zoom;
            return (
              <g key={r}>
                <line x1={0} x2={VIEWPORT.width} y1={y} y2={y} className="lab__rowline" />
                <text x={6} y={y - 4} className="lab__rowlabel">row {r}</text>
              </g>
            );
          })}

          {edges.map((r, i) => {
            const a = screen.get(r.from_person);
            const b = screen.get(r.to_person);
            if (!a || !b) return null;
            return (
              <line
                key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                className={r.type === 'partner'
                  ? `lab__edge lab__edge--partner${r.partner_status === 'former' ? ' is-former' : ''}`
                  : 'lab__edge lab__edge--parent'}
              />
            );
          })}

          {graph.people.map((p) => {
            const s = screen.get(p.id);
            if (!s) return null;
            const isActive = p.id === activeId;
            const isNear = plan?.nearIds?.has(p.id);
            return (
              <g
                key={p.id}
                data-testid={`node-${p.id}`}
                data-person={p.id}
                data-x={s.x.toFixed(3)}
                data-y={s.y.toFixed(3)}
                className={`lab__node${isActive ? ' is-active' : ''}${isNear ? ' is-near' : ''}`}
                onClick={() => select(p.id, s)}
              >
                <circle cx={s.x} cy={s.y} r={30 * cam.zoom} />
                <text x={s.x} y={s.y + 44 * cam.zoom} className="lab__name">{p.display_name}</text>
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
