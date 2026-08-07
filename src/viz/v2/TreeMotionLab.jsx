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

function pointOnQuad(a, m, b, t) {
  const mt = 1 - t;
  return { x: mt * mt * a.x + 2 * mt * t * m.x + t * t * b.x, y: mt * mt * a.y + 2 * mt * t * m.y + t * t * b.y };
}

/*
 * The same gentle hanging-cord sag as sagPath, but bent away from any
 * bubble it would otherwise pass behind — real, reported example: in the
 * three-pod fixture, the mediated line from a hub's outer partner down to
 * that partner's OWN child ran almost diagonally across the whole row and
 * cut straight through the middle partner's bubble, since nothing about
 * the plain hanging-cord shape knows other people exist.
 *
 * `obstacles` is every OTHER currently-visible person's render position —
 * never this segment's own two endpoints, which the curve is deliberately
 * anchored to and must still touch. Checked by sampling points along the
 * curve rather than solving it analytically (this is a bench, not a
 * production renderer — a handful of samples is plenty for a family-tree
 * -sized curve) and nudging the control point sideways, away from
 * whichever obstacle it's closest to, until clear or a few tries run out.
 * Best-effort, not a hard constraint solver: a genuinely crowded scene can
 * still have a rare residual graze, but the common "runs right behind an
 * unrelated bubble" case is what this fixes.
 */
function sagPathAvoiding(a, b, obstacles, clearance) {
  let mx = (a.x + b.x) / 2;
  let my = (a.y + b.y) / 2 + Math.abs(a.x - b.x) * 0.06;
  const dx = b.x - a.x, dy = b.y - a.y;
  const segLen = Math.hypot(dx, dy);
  if (segLen < 1 || !obstacles.length) return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
  const px = -dy / segLen, py = dx / segLen; // unit perpendicular to a->b

  for (let iter = 0; iter < 4; iter++) {
    let worst = null;
    for (const o of obstacles) {
      let minD = Infinity;
      for (let t = 0.15; t <= 0.85; t += 0.1) {
        const pt = pointOnQuad(a, { x: mx, y: my }, b, t);
        const d = Math.hypot(pt.x - o.x, pt.y - o.y);
        if (d < minD) minD = d;
      }
      if (minD < clearance && (!worst || minD < worst.minD)) worst = { o, minD };
    }
    if (!worst) break;
    const cross = dx * (worst.o.y - a.y) - dy * (worst.o.x - a.x);
    const dir = cross > 0 ? -1 : 1; // push the control point to the side AWAY from the obstacle
    const push = Math.min(clearance * 1.5, clearance - worst.minD + 10);
    mx += px * push * dir;
    my += py * push * dir;
  }
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
}

/*
 * sagPathAvoiding only ever moves a curve's BELLY (its control point) — the
 * two endpoints it's handed are treated as fixed anchors, correctly, since
 * one of them is usually a real person's bubble the line must actually
 * touch. But a merged co-parent pod's `start` point (below, in drawGroup)
 * isn't anyone's bubble — it's the midpoint between two parents' positions —
 * and in a row with 3+ adults, that midpoint can land almost exactly on top
 * of a THIRD, unrelated person sitting physically between the two parents
 * (the real three-pod case this whole feature was built for: Peter and
 * Bianca's midpoint lands on Alice, who sits between them in the row). No
 * amount of belly-nudging fixes a graze AT the anchor itself, so this pushes
 * the anchor point directly away from whichever obstacle it's nearest,
 * before any curve is ever built from it.
 */
function nudgePointFromObstacles(point, obstacles, clearance) {
  let p = { x: point.x, y: point.y };
  for (let iter = 0; iter < 4; iter++) {
    let worst = null;
    for (const o of obstacles) {
      const d = Math.hypot(p.x - o.x, p.y - o.y);
      if (d < clearance && (!worst || d < worst.d)) worst = { o, d };
    }
    if (!worst) break;
    const dx = p.x - worst.o.x, dy = p.y - worst.o.y;
    const len = Math.hypot(dx, dy) || 1;
    const push = clearance - worst.d + 10;
    p.x += (dx / len) * push;
    p.y += (dy / len) * push;
  }
  return p;
}

const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive';

/*
 * Additive reveal — the same `expanded` (tapped ids) ∪ neighbours formula
 * App.jsx's own visibleIds already uses, so tapping a bubble here means the
 * same thing it means in the real app: you and everyone directly connected
 * to you become visible, not just the person you tapped. "Collapse" just
 * means resetting `expanded` back to the one starting id — see the reset in
 * the engine-rebuild effect below.
 */
function computeVisibleIds(graph, expanded) {
  const ids = new Set();
  for (const id of expanded) {
    ids.add(id);
    for (const q of graph.parents(id)) ids.add(q.id);
    for (const q of graph.children(id)) ids.add(q.id);
    for (const q of graph.partners(id)) ids.add(q.id);
  }
  return ids;
}

/*
 * Parent→child links, merged at the co-parent level exactly like
 * links.js's own `groups`/`divorceGroups` pass: two co-parents (current OR
 * former partners) share one visual origin rather than each drawing an
 * independent line, and 2+ children under one couple share a single
 * stem→junction→branches trunk instead of a fan of lines all leaving the
 * same point. `renderPos(id)` already includes the organic jitter, so the
 * curves visually terminate exactly on the (slightly offset) bubble.
 */
function buildParentChildLinks(graph, resolve, nodeR) {
  const links = []; // { path, biological, former, opacity }
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

  // Every currently-visible person's position, for obstacle lookups below —
  // built once rather than per-segment. See sagPathAvoiding's own comment
  // for why this matters (a mediated line can otherwise cut straight
  // through an unrelated bubble in between its two real endpoints).
  const allPositions = new Map();
  for (const person of graph.people) {
    const r = resolve(person.id);
    if (r) allPositions.set(person.id, r.pos);
  }
  const clearance = nodeR + 10;
  const obstaclesExcept = (...excludeIds) => {
    const ex = new Set(excludeIds);
    const out = [];
    for (const [id, pos] of allPositions) if (!ex.has(id)) out.push(pos);
    return out;
  };

  const drawGroup = (grp) => {
    const r1 = resolve(grp.p1), r2 = resolve(grp.p2);
    if (!r1 || !r2) return;
    const parentOpacity = Math.min(r1.opacity, r2.opacity);
    const biological = isBioAdopt(grp.qualifier);
    const kidEntries = grp.kids.map((id) => ({ id, r: resolve(id) })).filter((e) => e.r);
    if (!kidEntries.length) return;
    // Excludes the group's OWN parents/kids from obstacle-avoidance —
    // siblings fanning out from the same junction naturally pass near each
    // other, and each branch trying to dodge its own sisters would fight
    // the others computed independently right beside it. Only genuinely
    // unrelated bubbles count as obstacles here.
    const obstacles = obstaclesExcept(grp.p1, grp.p2, ...grp.kids);
    // The pod midpoint isn't anyone's bubble, so — unlike a curve's real
    // endpoints — it's free to move. In a 3+-adult row this is exactly
    // where a third, unrelated person can end up sitting: see
    // nudgePointFromObstacles' own comment for the real three-pod case
    // that motivated this.
    const start = nudgePointFromObstacles(
      { x: (r1.pos.x + r2.pos.x) / 2, y: (r1.pos.y + r2.pos.y) / 2 + nodeR * 1.05 },
      obstacles, clearance,
    );
    const add = (a, b, opacity) => links.push({ path: sagPathAvoiding(a, b, obstacles, clearance), biological, former: grp.former, opacity });
    if (kidEntries.length === 1) {
      add(start, kidEntries[0].r.pos, Math.min(parentOpacity, kidEntries[0].r.opacity));
    } else {
      const avgX = kidEntries.reduce((s, e) => s + e.r.pos.x, 0) / kidEntries.length;
      const nearestY = Math.min(...kidEntries.map((e) => e.r.pos.y));
      const junction = nudgePointFromObstacles(
        { x: start.x * 0.55 + avgX * 0.45, y: start.y + (nearestY - start.y) * 0.72 },
        obstacles, clearance,
      );
      const stemOpacity = Math.max(parentOpacity, ...kidEntries.map((e) => e.r.opacity));
      add(start, junction, stemOpacity);
      for (const e of kidEntries) add(junction, e.r.pos, Math.min(parentOpacity, e.r.opacity));
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
      const ra = resolve(parent.id), rb = resolve(person.id);
      if (!ra || !rb) continue;
      const obstacles = obstaclesExcept(parent.id, person.id);
      links.push({
        path: sagPathAvoiding(ra.pos, rb.pos, obstacles, clearance),
        biological: isBioAdopt(parent.qualifier), former: false, opacity: Math.min(ra.opacity, rb.opacity),
      });
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

  // Additive reveal (expand) / Collapse — V2 only, see computeVisibleIds'
  // own comment for why `expanded` means the same thing it means in
  // App.jsx. V1 has no equivalent in this lab; it keeps showing everyone,
  // exactly as it always has, so the V1/V2 motion comparison stays
  // apples-to-apples.
  const [expanded, setExpanded] = useState(() => new Set([fixture.focus]));

  // Rebuild the engine whenever the experiment's inputs change.
  useEffect(() => {
    const initialExpanded = new Set([fixture.focus]);
    const engine = version === 'v2'
      ? createMotionEngine({ graph, viewport: VIEWPORT, ambient, visibleIds: computeVisibleIds(graph, initialExpanded) })
      : createLegacyEngine({ graph, viewport: VIEWPORT });
    engine.select(fixture.focus);
    engineRef.current = engine;
    setActiveId(fixture.focus);
    setSummary(null);
    setPan({ x: 0, y: 0 });
    setPins(new Map());
    setExpanded(initialExpanded);
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

  // A bubble tap both selects AND reveals — the same single gesture
  // production uses (tapping a person makes them active AND brings their
  // immediate family into view). visibleIds is updated BEFORE select() so
  // the replan that select() triggers already sees the newly revealed
  // people — see engine.js's own setVisibleIds() comment for why
  // reselecting is what actually applies it.
  const revealAndSelect = useCallback((id, screenPoint) => {
    const engine = engineRef.current;
    if (engine && version === 'v2' && !expanded.has(id)) {
      const nextExpanded = new Set(expanded).add(id);
      engine.setVisibleIds(computeVisibleIds(graph, nextExpanded));
      setExpanded(nextExpanded);
    }
    select(id, screenPoint);
  }, [version, expanded, graph, select]);

  // Collapse back down to just the current active person's immediate
  // family — the inverse of reveal. Reselecting the SAME active person
  // (no screenPoint override) makes select() default to "wherever they
  // already are on screen," so collapsing never moves or re-anchors them.
  const collapse = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || version !== 'v2') return;
    const nextExpanded = new Set([activeId]);
    engine.setVisibleIds(computeVisibleIds(graph, nextExpanded));
    setExpanded(nextExpanded);
    select(activeId);
  }, [version, activeId, graph, select]);

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

  // Smooth expand/collapse ("cinematic", not a pop): SpringField.setTargets
  // deletes a no-longer-visible person's tracked state the instant
  // visibleIds shrinks (see springs.js) — collapsing would otherwise make
  // people vanish on the spot instead of receding. This tracks every
  // visible person's last known on-screen look each frame; the moment
  // someone drops out, that look is kept and eased to nothing over
  // EXIT_MS rather than deleted with the spring state. The mirror case
  // (someone newly revealed) already gets a smooth ARRIVAL for free from
  // the spring itself (engine.js's select() spawns new arrivals at the
  // active person's position and springs them out — "revealed, not
  // thrown"), so this only adds a brief scale-in on top of that existing
  // motion, for a matching grow-in read rather than snapping to full size.
  // All of this is intentionally read from refs and mutated during render:
  // the component already re-renders on every animation frame (the tick
  // loop's forceRender), so this diffing runs in lockstep with that clock —
  // there is no separate timer to coordinate.
  const ENTER_MS = 320;
  const EXIT_MS = 380;
  const lastSeenRef = useRef(new Map()); // personId -> { rp, base, ini, deceased }
  const enteringRef = useRef(new Map()); // personId -> startedAt
  const exitingRef = useRef(new Map());  // personId -> { start, from: {...} }
  const now = performance.now();
  for (const p of graph.people) {
    const rp = renderPos(p.id);
    if (rp) {
      if (!lastSeenRef.current.has(p.id) && !enteringRef.current.has(p.id)) {
        enteringRef.current.set(p.id, now);
      }
      lastSeenRef.current.set(p.id, {
        rp, base: monogramColors(p.display_name).base, ini: initials(p.display_name), deceased: p.is_deceased,
      });
      exitingRef.current.delete(p.id); // reappeared (e.g. re-expanded) before its exit finished
    } else if (lastSeenRef.current.has(p.id)) {
      if (!exitingRef.current.has(p.id)) {
        exitingRef.current.set(p.id, { start: now, from: lastSeenRef.current.get(p.id) });
      }
      lastSeenRef.current.delete(p.id);
    }
  }
  for (const [id, t] of enteringRef.current) if (now - t > ENTER_MS) enteringRef.current.delete(id);
  for (const [id, ex] of exitingRef.current) if (now - ex.start > EXIT_MS) exitingRef.current.delete(id);

  const enterScale = (id) => {
    const t = enteringRef.current.get(id);
    if (t == null) return 1;
    return Math.min(1, (now - t) / ENTER_MS);
  };
  // Position + opacity multiplier for a link endpoint, honouring an exiting
  // node's last known spot (rather than the link just vanishing the same
  // frame the node's own circle starts fading) — normal, still-visible
  // endpoints are completely unaffected (opacity 1, exact renderPos).
  const posOrExiting = (id) => {
    const rp = renderPos(id);
    if (rp) return { pos: rp, opacity: 1 };
    const ex = exitingRef.current.get(id);
    if (!ex) return null;
    const t = Math.min(1, (now - ex.start) / EXIT_MS);
    return { pos: ex.from.rp, opacity: 1 - t };
  };

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

  // Deliberately NOT memoized on a stable dependency list — posOrExiting
  // reads the live exitingRef every call, and a link touching an exiting
  // person must re-fade every frame right along with that person's own
  // circle. `now` (recomputed every render, i.e. every animation frame)
  // is what actually drives that.
  const parentChildLinks = buildParentChildLinks(graph, posOrExiting, nodeR);

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
        {version === 'v2' && (
          <>
            <button
              className="lab__btn"
              data-testid="collapse-btn"
              onClick={collapse}
              disabled={expanded.size <= 1}
            >
              Collapse
            </button>
            <span className="lab__visible-count" data-testid="visible-count">
              {screen.size} / {graph.people.length} visible
            </span>
          </>
        )}
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
            const ra = posOrExiting(aId), rb = posOrExiting(bId);
            if (!ra || !rb) return null;
            return (
              <line
                key={`p${i}`}
                x1={ra.pos.x} y1={ra.pos.y} x2={rb.pos.x} y2={rb.pos.y}
                style={{ opacity: Math.min(ra.opacity, rb.opacity) }}
                className={`lab__edge lab__edge--partner${former ? ' is-former' : ''}`}
              />
            );
          })}

          {/* Parent→child links — merged at the couple level with a
              stem→junction→branches trunk for 2+ children, a gentle
              hanging-cord sag instead of a straight line, exactly like the
              real canvas (see buildParentChildLinks' own header). Opacity
              follows a fading endpoint (see posOrExiting) so a link never
              just vanishes the instant its person does. */}
          {parentChildLinks.map((link, i) => (
            <path
              key={`c${i}`}
              d={link.path}
              style={{ opacity: link.opacity }}
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
            const scale = enterScale(p.id);
            const r = nodeR * scale;
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
                  revealAndSelect(p.id, s);
                }}
              >
                {p.is_deceased && (
                  <circle className="lab__node-memring" cx={rp.x} cy={rp.y} r={r + 4} style={{ opacity: scale }} />
                )}
                <circle
                  className="lab__node-fill"
                  cx={rp.x} cy={rp.y} r={r}
                  style={{ fill: base, opacity: scale }}
                />
                {isActive && (
                  <circle className="lab__node-activering" cx={rp.x} cy={rp.y} r={r + 2.5} style={{ opacity: scale }} />
                )}
                <text x={rp.x} y={rp.y + r * 0.11} className="lab__initials" style={{ opacity: scale, fontSize: 12 * scale }}>{initials(p.display_name)}</text>
                <text x={rp.x} y={rp.y + r + 16} className="lab__name" style={{ opacity: scale }}>{p.display_name}</text>
              </g>
            );
          })}

          {/* Exiting (collapsed/hidden) people — see the exitingRef comment
              above renderPos. Shrinks and fades in place at their last
              known spot rather than the pop a raw springs.setTargets()
              removal would otherwise produce. */}
          {[...exitingRef.current.entries()].map(([id, ex]) => {
            const t = Math.min(1, (now - ex.start) / EXIT_MS);
            const scale = 1 - t;
            const r = Math.max(0, nodeR * scale);
            return (
              <g key={`exit-${id}`} style={{ pointerEvents: 'none' }}>
                <circle cx={ex.from.rp.x} cy={ex.from.rp.y} r={r} style={{ fill: ex.from.base, opacity: scale }} />
                {ex.from.deceased && (
                  <circle cx={ex.from.rp.x} cy={ex.from.rp.y} r={r + 4} className="lab__node-memring" style={{ opacity: scale }} />
                )}
                <text x={ex.from.rp.x} y={ex.from.rp.y + r * 0.11} className="lab__initials" style={{ opacity: scale, fontSize: 12 * scale }}>{ex.from.ini}</text>
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
