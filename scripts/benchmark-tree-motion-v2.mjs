#!/usr/bin/env node
/**
 * Tree Motion Lab (V2 physics) — large-tree benchmark harness.
 *
 * Closes the last item of the Codex review's P2 #8 ("the fixtures are
 * small... add 1,100- and 5,000-person graph benchmarks using the
 * intended production working-set/scene budget. Also benchmark unit
 * construction for transitive/large partner data"). Console-only,
 * deliberately not wired into CI's pass/fail gate — wall-clock numbers
 * vary by machine, same reasoning as scripts/benchmark-phase0.mjs, whose
 * fixture generator and conventions this reuses directly rather than
 * building a second synthetic-data generator.
 *
 * Two distinct measurements, matching the review's own two asks:
 *
 *   1. Large GRAPH, production-realistic SCENE. A 1,100- or 5,000-person
 *      graph is built, but the V2 engine is never asked to plan/animate
 *      the whole thing — production never does that either: App.jsx's
 *      "All" reveal caps at MAX_BUBBLE_REVEAL (250, see App.jsx and
 *      scripts/benchmark-phase0.mjs's own STATIC table) and reveals only
 *      the people nearest the active one above that size. This benchmark
 *      reproduces exactly that: distancesFrom() picks the 250 nearest
 *      people in the LARGE graph as visibleIds, and planFamilyLayout +
 *      the full motion engine (spring settle, collision, ambient) are
 *      timed against that realistic scene, while graph lookups
 *      (parents/children/partners) still pay the cost of the full
 *      large graph underneath.
 *
 *   2. A large TRANSITIVE partner network. The P1 fix in this same PR
 *      (buildUnits' transitive partner-chain union) is proven CORRECT at
 *      4 people by the dedicated `partner-chain` fixture and its
 *      regression tests — this benchmarks the same code path's
 *      PERFORMANCE at a stress scale no hand-written fixture would be
 *      practical to author: a long chain of alternating current/former
 *      partnerships (matching the proven-correct shape, just scaled up),
 *      confirming pod sizes stay correct (no runaway transitive merge)
 *      and construction time stays reasonable as the chain grows.
 *
 * Run with: node scripts/benchmark-tree-motion-v2.mjs
 */
import { generateFamilyFixture } from '../src/lib/fixtureGenerator.js';
import { buildGraph, distancesFrom } from '../src/data/graph.js';
import { planFamilyLayout } from '../src/viz/v2/layoutPlanner.js';
import { createMotionEngine } from '../src/viz/v2/engine.js';

const SIZES = [1100, 5000];
const SCENE_BUDGET = 250; // MAX_BUBBLE_REVEAL — App.jsx's real production cap
const VIEWPORT = { width: 1200, height: 800 };
const FRAME = 16.667;
const MAX_SETTLE_FRAMES = 600; // 10s wall-clock ceiling — if it hasn't settled by then, that's itself the finding

function timeIt(fn) {
  const t0 = performance.now();
  const result = fn();
  return { result, elapsed: performance.now() - t0 };
}

function fmtMs(n) { return `${n.toFixed(2)} ms`; }

function settleAndCount(engine) {
  let frames = 0;
  while (frames < MAX_SETTLE_FRAMES) {
    engine.step(FRAME);
    frames++;
    if (engine.isSettled()) break;
  }
  return frames;
}

console.log('=== Tree Motion Lab V2 — large-tree / production-scene benchmark ===\n');

for (const size of SIZES) {
  console.log(`--- ${size}-person graph, ${SCENE_BUDGET}-person scene budget (matches App.jsx's MAX_BUBBLE_REVEAL) ---`);

  const { result: { tree }, elapsed: genMs } = timeIt(() => generateFamilyFixture({ size, seed: size }));
  const { result: graph, elapsed: buildGraphMs } = timeIt(() => buildGraph(tree.people, tree.relationships));
  const activeId = tree.myPersonId ?? tree.people[0].id;

  const { result: dist, elapsed: distancesMs } = timeIt(() => distancesFrom(graph, activeId));
  const nearest = [...dist.entries()].sort((a, b) => a[1] - b[1]).slice(0, SCENE_BUDGET).map(([id]) => id);
  const visibleIds = new Set(nearest);
  if (!visibleIds.has(activeId)) visibleIds.add(activeId);

  const { result: plan, elapsed: planMs } = timeIt(() =>
    planFamilyLayout({ graph, activeId, visibleIds, viewport: VIEWPORT }));

  let positionsFinite = true;
  for (const id of visibleIds) {
    const pt = plan.positions.get(id);
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) positionsFinite = false;
  }

  const { result: engine, elapsed: engineCreateMs } = timeIt(() =>
    createMotionEngine({ graph, viewport: VIEWPORT, visibleIds }));
  const { result: settleFrames, elapsed: settleWallMs } = timeIt(() => {
    engine.select(activeId);
    return settleAndCount(engine);
  });
  const settled = engine.isSettled();
  const summary = engine.summary?.() ?? null;

  console.log(`  fixture generation:      ${fmtMs(genMs)}`);
  console.log(`  buildGraph:               ${fmtMs(buildGraphMs)}  (${tree.people.length} people, ${tree.relationships.length} relationships — full graph)`);
  console.log(`  distancesFrom (full graph, picking nearest ${SCENE_BUDGET}): ${fmtMs(distancesMs)}  (reached ${dist.size} people)`);
  console.log(`  planFamilyLayout (${visibleIds.size}-person scene):  ${fmtMs(planMs)}  positions finite: ${positionsFinite}`);
  console.log(`  createMotionEngine:       ${fmtMs(engineCreateMs)}`);
  console.log(`  select() + settle:        ${fmtMs(settleWallMs)}  (${settleFrames} simulated frames, settled=${settled})`);
  if (summary) {
    console.log(`  motion summary: maxNodeDisplacementPx=${summary.maxNodeDisplacementPx} maxCollisionPush=${summary.maxCollisionPush} passed=${summary.passed}${summary.failures.length ? ` failures=${JSON.stringify(summary.failures)}` : ''}`);
  }
  console.log('');
}

console.log('--- Large transitive partner network (unit construction stress case) ---');
console.log('Chain of N people, alternating former/current partnerships (the same shape');
console.log('the `partner-chain` fixture proves CORRECT at 4 people — this scales it up');
console.log('to check buildUnits\' performance and that pods still stay correctly bounded).');
console.log('buildUnits pods a person with ALL their DIRECT partners regardless of status');
console.log('(see layoutPlanner.js: "Former partners to the left of the anchor, current to');
console.log('the right" — a former partner still shares the pod, just placed differently),');
console.log('so in a linear chain the active person\'s own pod is legitimately hub+2');
console.log('neighbors = 3; the real invariant the P1 fix protects is that this stays');
console.log('CONSTANT as the chain grows, rather than following the chain transitively —');
console.log('i.e. maxPodSize must NOT grow with chain length.\n');

const podSizesBySize = [];
for (const chainLength of [50, 200, 500]) {
  const people = [];
  const relationships = [];
  for (let i = 0; i < chainLength; i++) {
    people.push({
      id: `pc_${i}`,
      display_name: `Person ${i}`,
      given_names: `Person`,
      family_name: `${i}`,
      birth_date: `${1950 + (i % 60)}`,
      gender: i % 2 === 0 ? 'male' : 'female',
    });
  }
  // Alternate current/former exactly like the partner-chain fixture: even-index
  // links are 'former' (chain-breaking), odd-index links are current (pod-forming
  // in pairs) — so the correct pod structure is many 2-person pods, never one
  // giant N-person pod, regardless of how long the chain grows.
  for (let i = 0; i < chainLength - 1; i++) {
    relationships.push({
      id: `pr_${i}`,
      from_person: `pc_${i}`,
      to_person: `pc_${i + 1}`,
      type: 'partner',
      partner_status: i % 2 === 0 ? 'former' : 'current',
    });
  }

  const graph = buildGraph(people, relationships);
  const activeId = `pc_${Math.floor(chainLength / 2)}`;
  const { result: plan, elapsed: planMs } = timeIt(() =>
    planFamilyLayout({ graph, activeId, viewport: VIEWPORT }));

  const activeUnit = plan.units.find((u) => u.memberIds.includes(activeId));
  const maxPodSize = Math.max(...plan.units.map((u) => u.memberIds.length));
  podSizesBySize.push({ chainLength, maxPodSize, activePodSize: activeUnit.memberIds.length });
  let positionsFinite = true;
  for (const id of people.map((p) => p.id)) {
    const pt = plan.positions.get(id);
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) positionsFinite = false;
  }

  console.log(`  chain of ${chainLength}: planFamilyLayout ${fmtMs(planMs)}  units=${plan.units.length}  maxPodSize=${maxPodSize}  activePodSize=${activeUnit.memberIds.length}  positions finite: ${positionsFinite}`);
}

const allMaxPodSizes = podSizesBySize.map((r) => r.maxPodSize);
const podSizeIsConstant = allMaxPodSizes.every((n) => n === allMaxPodSizes[0]);
console.log(`\n  maxPodSize across chain lengths [${podSizesBySize.map((r) => r.chainLength).join(', ')}]: [${allMaxPodSizes.join(', ')}] — ${podSizeIsConstant ? 'CONSTANT (no transitive over-merge as the chain grows)' : '! GROWING WITH CHAIN LENGTH — possible transitive over-merge regression'}`);

console.log('\nDone. This is a reporting script (console-only) — see its header for why it is not part of the CI pass/fail gate.');
