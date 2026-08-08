import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force';
import { computeGenerations } from '../../data/graph.js';
import { MotionRecorder } from './metrics.js';
import { toScreen } from './layoutPlanner.js';

/*
 * V1 reference engine — the production force setup, reproduced behind the same
 * interface as the V2 engine so the lab can run both on the same fixture and a
 * reviewer can judge them side by side.
 *
 * IMPORTANT about what this is and is not. It reproduces production's LAYOUT
 * BEHAVIOUR — the same constants, the same forces, the same "reheat on click"
 * — because that is what the experiment is about. It is not the PixiJS
 * renderer, and it is not imported by anything outside the lab, so nothing
 * here can affect what ships. The constants below are copied from
 * src/viz/BubbleTree.jsx and are the honest thing to compare against; if that
 * file's constants change, this comparison goes stale and should be refreshed.
 */

const GEN_GAP = 280;
const COLLIDE = 70;
const ORGANIC_CHARGE = -1800;
const SPREAD_X = 0.004;
const RESTING_Y = 0.085;
const REHEAT_Y = 0.45;
const REHEAT_ALPHA = 0.88;

export function createLegacyEngine({
  graph,
  viewport = { width: 1200, height: 800 },
  visibleIds = null,
} = {}) {
  const visible = visibleIds instanceof Set ? visibleIds : new Set(visibleIds ?? graph.people.map((p) => p.id));
  const gen = computeGenerations(graph);
  const recorder = new MotionRecorder();

  const nodes = graph.people.filter((p) => visible.has(p.id)).map((p, i) => ({
    id: p.id,
    // Deterministic spawn — production randomises here, which would make the
    // comparison unrepeatable. A fixed spiral is the closest fair stand-in.
    x: Math.cos(i * 2.399) * (40 + i * 9),
    y: (gen.get(p.id) ?? 0) * GEN_GAP - 260 + Math.sin(i * 2.399) * 12,
  }));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const layoutGen = (id) => {
    let g = gen.get(id) ?? 0;
    if (graph.parents(id).length === 0) {
      for (const p of graph.partners(id)) g = Math.max(g, gen.get(p.id) ?? 0);
    }
    return g;
  };
  const genY = (d) => layoutGen(d.id) * GEN_GAP - 260;

  const links = graph.relationships
    .filter((r) => (r.type === 'partner' || r.type === 'parent') && nodeById.has(r.from_person) && nodeById.has(r.to_person))
    .map((r) => ({ source: r.from_person, target: r.to_person, kind: r.type }));

  const linkForce = forceLink(links).id((d) => d.id)
    .distance((l) => (l.kind === 'partner' ? 112 : 280))
    .strength((l) => (l.kind === 'partner' ? 0.9 : 0.26));

  const sim = forceSimulation(nodes)
    .force('link', linkForce)
    .force('charge', forceManyBody().strength(ORGANIC_CHARGE).distanceMax(1200))
    .force('collide', forceCollide(COLLIDE).strength(0.9))
    .force('x', forceX(0).strength(SPREAD_X))
    .force('y', forceY(genY).strength(RESTING_Y))
    .alpha(1)
    .alphaDecay(0.018)
    .alphaTarget(0.012)   // production never lets it fully stop — that is the point
    .stop();
  for (let i = 0; i < 220; i++) sim.tick();

  let activeId = null;
  let reheatFramesLeft = 0;
  let lastActiveScreen = null;
  let prevPositions = new Map();

  // Production frames the visible bounding box every frame; reproduced here so
  // the comparison includes the camera behaviour, not just the node motion.
  const camera = () => {
    const pts = nodes.map((n) => ({ x: n.x, y: n.y }));
    if (!pts.length) return { worldX: 0, worldY: 0, screenX: viewport.width / 2, screenY: viewport.height / 2, zoom: 1 };
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
    const zoom = Math.max(0.2, Math.min(1.35,
      Math.min((viewport.width * 0.8) / Math.max(1, maxX - minX), (viewport.height * 0.72) / Math.max(1, maxY - minY))));
    const a = nodeById.get(activeId);
    // Ego camera biased toward the active person, same idea as production.
    const cx = a ? (a.x * 0.66 + ((minX + maxX) / 2) * 0.34) : (minX + maxX) / 2;
    const cy = a ? (a.y * 0.66 + ((minY + maxY) / 2) * 0.34) : (minY + maxY) / 2;
    return { worldX: cx, worldY: cy, screenX: viewport.width / 2, screenY: viewport.height / 2, zoom };
  };

  const worldPositions = () => new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const screenPositions = () => {
    const cam = camera();
    return new Map(nodes.map((n) => [n.id, toScreen(cam, n)]));
  };

  function select(id) {
    activeId = id;
    // The behaviour under review: a click reheats the WHOLE simulation and
    // spikes the band force, so every node in the tree starts moving again.
    sim.force('y', forceY(genY).strength(REHEAT_Y));
    sim.alpha(REHEAT_ALPHA);
    reheatFramesLeft = Math.round(1800 / 16.667);
    prevPositions = worldPositions();
    lastActiveScreen = screenPositions().get(activeId) ?? null;
    recorder.beginTransition(`select:${id}`);
    return null;
  }

  function step(dtMs) {
    const dt = Math.max(0, dtMs / 1000);
    sim.tick();
    if (reheatFramesLeft > 0 && --reheatFramesLeft === 0) {
      sim.force('y', forceY(genY).strength(RESTING_Y));
    }

    const world = worldPositions();
    let peak = 0;
    let sum = 0;
    let unsettled = 0;
    for (const [id, pt] of world) {
      const prev = prevPositions.get(id) ?? pt;
      const speed = Math.hypot(pt.x - prev.x, pt.y - prev.y) / (dt || 1 / 60);
      peak = Math.max(peak, speed);
      sum += speed;
      if (speed > 0.5) unsettled++;
    }
    prevPositions = world;

    const activeScreen = screenPositions().get(activeId) ?? null;
    const activeDrift = lastActiveScreen && activeScreen
      ? Math.hypot(activeScreen.x - lastActiveScreen.x, activeScreen.y - lastActiveScreen.y)
      : 0;
    lastActiveScreen = activeScreen;

    const frame = {
      dt,
      peakSpeed: peak,
      meanSpeed: world.size ? sum / world.size : 0,
      activeDrift,
      cameraSpeed: 0,
      zoom: camera().zoom,
      unsettled,
      maxPush: 0,
      // alphaTarget is non-zero by design in production, so this never becomes
      // true — which is precisely the property the experiment is challenging.
      settled: unsettled === 0,
    };
    recorder.frame(frame);
    return frame;
  }

  function settle({ dtMs = 16.667, maxFrames = 600 } = {}) {
    let frames = 0;
    let last = null;
    while (frames < maxFrames) { last = step(dtMs); frames++; if (last.settled) break; }
    return { frames, ...last };
  }

  return {
    select,
    step,
    settle,
    camera,
    worldPositions,
    screenPositions,
    get plan() { return null; },
    get activeId() { return activeId; },
    isSettled: () => false,
    metrics: () => recorder,
    summary: () => recorder.summary(),
    resetMetrics: (label) => recorder.reset(label),
    breatheOnly() {},
  };
}
