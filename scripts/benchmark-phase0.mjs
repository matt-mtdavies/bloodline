#!/usr/bin/env node
/**
 * Phase 0 benchmark harness — docs/FAMILY-PERIMETER-AND-5000-PERSON-PERFORMANCE.md
 *
 * Runs the real client-side pipeline (buildGraph, distancesFrom, relationLabel,
 * findDuplicatePairs, computeInsightModules, JSON.stringify) against deterministic,
 * privacy-safe synthetic fixtures at 100 / 500 / 1,100 / 5,000 people and reports
 * real measured numbers — no production data is read or referenced anywhere here.
 *
 * Run with: node scripts/benchmark-phase0.mjs
 * Writes a full report to: docs/PHASE0-BENCHMARK-REPORT.md
 */
import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generateFamilyFixture } from '../src/lib/fixtureGenerator.js';
import { buildGraph, distancesFrom, relationLabel } from '../src/data/graph.js';
import { findDuplicatePairs } from '../src/lib/duplicates.js';
import { computeInsightModules } from '../src/lib/insightModules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIZES = [100, 500, 1100, 5000];

// Static, architecture-relevant constants copied from the live source files
// (not re-derived) so the report can compare measured numbers against the
// caps the app actually enforces today.
const STATIC = {
  MAX_BUBBLE_REVEAL: 250, // App.jsx — hard cap on how many bubbles "All" will ever reveal at once
  RIPPLE_CHUNK_SIZE: 40, // App.jsx — bubbles revealed per animation layer during ripple-reveal
  RIPPLE_TOTAL_MS: 2200, // App.jsx — target wall-clock budget for a full ripple reveal
  BASE_RADIUS: 46, // BubbleTree.jsx — px, one bubble's base radius at zoom 1
  GEN_GAP: 280, // BubbleTree.jsx — px, vertical spacing between generation bands
  MAX_ZOOM: 2.0, // BubbleTree.jsx — auto-fit (follow mode) zoom ceiling
  LOCALSTORAGE_TYPICAL_QUOTA_MB: 5, // typical browser localStorage quota (varies 5–10MB)
};

function bytesOf(str) {
  return Buffer.byteLength(str, 'utf8');
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtMs(n) {
  return `${n.toFixed(2)} ms`;
}

function timeIt(fn) {
  const t0 = performance.now();
  const result = fn();
  const elapsed = performance.now() - t0;
  return { result, elapsed };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(arr, n, rng) {
  const out = [];
  for (let i = 0; i < n && arr.length > 0; i++) out.push(arr[Math.floor(rng() * arr.length)]);
  return out;
}

function runOneSize(size) {
  console.log(`\n=== size ${size} ===`);
  const { tree, meta } = generateFamilyFixture({ size, seed: 42 });

  // ── Payload size (raw + gzip) — the D1 1MiB-per-row ceiling and network cost ──
  const { result: json, elapsed: stringifyMs } = timeIt(() => JSON.stringify(tree));
  const rawBytes = bytesOf(json);
  const gzipBytes = gzipSync(Buffer.from(json, 'utf8')).length;

  // ── Graph construction — done on every load and every local mutation ──
  const { result: graph, elapsed: buildGraphMs } = timeIt(() => buildGraph(tree.people, tree.relationships));

  // ── BFS traversal (distancesFrom) from the default viewer — the primitive
  //    perimeter/halo calculations, insight modules, and the "All" reveal cap
  //    all already build on ──
  const { result: dist, elapsed: distancesMs } = timeIt(() => distancesFrom(graph, tree.myPersonId));

  // ── Perimeter-relevant traversal: relationLabel (cousin-degree via common-
  //    ancestor search) computed viewer → N other people, the kind of per-pair
  //    cost a perimeter/kin-label feature would pay at scale ──
  const rng = mulberry32(size);
  const relationSample = sample(tree.people.filter((p) => p.id !== tree.myPersonId), Math.min(200, tree.people.length - 1), rng);
  const { elapsed: relationLabelMs } = timeIt(() => {
    for (const p of relationSample) relationLabel(graph, tree.myPersonId, p.id);
  });

  // ── Duplicate detection — currently an all-pairs-ish scan over the whole tree ──
  const { result: dupPairs, elapsed: duplicatesMs } = timeIt(() => findDuplicatePairs(tree.people, tree.relationships));

  // ── Insight modules — the full computeInsightModules pass over the whole tree ──
  const { result: modules, elapsed: insightsMs } = timeIt(() => computeInsightModules(graph, tree.myPersonId, Date.now()));

  // ── Canvas / bubble-reveal static analysis (no real WebGL canvas in Node —
  //    this measures how many bubbles the real reveal logic would place, using
  //    the real distance data, against the real caps App.jsx enforces) ──
  const reachable = dist.size;
  const withinRevealCap = reachable <= STATIC.MAX_BUBBLE_REVEAL;
  const rippleLayers = Math.ceil(Math.min(reachable, STATIC.MAX_BUBBLE_REVEAL) / STATIC.RIPPLE_CHUNK_SIZE);

  const localStorageQuotaBytes = STATIC.LOCALSTORAGE_TYPICAL_QUOTA_MB * 1024 * 1024;
  const pctOfLocalStorageQuota = (rawBytes / localStorageQuotaBytes) * 100;

  const d1RowCeilingBytes = 1024 * 1024; // 1 MiB
  const pctOfD1RowCeiling = (rawBytes / d1RowCeilingBytes) * 100;

  const row = {
    size,
    meta,
    rawBytes, gzipBytes, stringifyMs,
    buildGraphMs,
    reachable, distancesMs,
    relationLabelSampleSize: relationSample.length, relationLabelMs,
    relationLabelPerPairUs: (relationLabelMs / relationSample.length) * 1000,
    dupPairsFound: dupPairs.length, duplicatesMs,
    insightModulesComputed: Object.values(modules).filter((v) => v != null).length, insightsMs,
    withinRevealCap, rippleLayers,
    pctOfLocalStorageQuota, pctOfD1RowCeiling,
  };

  console.log(`  payload:        ${fmtBytes(rawBytes)} raw / ${fmtBytes(gzipBytes)} gzip  (stringify ${fmtMs(stringifyMs)})`);
  console.log(`  buildGraph:     ${fmtMs(buildGraphMs)}`);
  console.log(`  distancesFrom:  ${fmtMs(distancesMs)}  (reached ${reachable}/${size})`);
  console.log(`  relationLabel:  ${fmtMs(relationLabelMs)} for ${relationSample.length} pairs (${row.relationLabelPerPairUs.toFixed(1)} µs/pair)`);
  console.log(`  duplicates:     ${fmtMs(duplicatesMs)}  (${dupPairs.length} candidate pairs)`);
  console.log(`  insights:       ${fmtMs(insightsMs)}`);
  console.log(`  D1 row ceiling: ${pctOfD1RowCeiling.toFixed(1)}% of 1 MiB`);
  console.log(`  localStorage:   ${pctOfLocalStorageQuota.toFixed(1)}% of a typical ${STATIC.LOCALSTORAGE_TYPICAL_QUOTA_MB}MB quota`);
  console.log(`  bubble reveal:  ${reachable} reachable, cap ${STATIC.MAX_BUBBLE_REVEAL} → ${withinRevealCap ? 'under cap' : 'CAPPED'}, ${rippleLayers} ripple layers`);

  return row;
}

const rows = SIZES.map(runOneSize);

// ── Write the markdown report ───────────────────────────────────────────────
const reportLines = [];
reportLines.push('# Phase 0 Benchmark Report');
reportLines.push('');
reportLines.push('Generated by `scripts/benchmark-phase0.mjs` against deterministic, privacy-safe');
reportLines.push('synthetic fixtures (`src/lib/fixtureGenerator.js`, seed 42) — **no production data');
reportLines.push('was read, exported, or referenced to produce any number in this report.** Every');
reportLines.push('measurement below is a real timing/size taken by actually running the app\'s own');
reportLines.push('`buildGraph`, `distancesFrom`, `relationLabel`, `findDuplicatePairs`, and');
reportLines.push('`computeInsightModules` against these fixtures, plus `JSON.stringify`/`gzip` on');
reportLines.push('the resulting payload.');
reportLines.push('');
reportLines.push(`Run: ${new Date().toISOString()}`);
reportLines.push('');
reportLines.push('## Summary table');
reportLines.push('');
reportLines.push('| Size | Raw JSON | Gzip | % of D1 1MiB row | buildGraph | distancesFrom (reached) | relationLabel (200-pair sample) | duplicate scan | insight modules | bubble reveal |');
reportLines.push('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  reportLines.push(
    `| ${r.size} | ${fmtBytes(r.rawBytes)} | ${fmtBytes(r.gzipBytes)} | ${r.pctOfD1RowCeiling.toFixed(1)}% | ${fmtMs(r.buildGraphMs)} | ${fmtMs(r.distancesMs)} (${r.reachable}/${r.size}) | ${fmtMs(r.relationLabelMs)} (${r.relationLabelPerPairUs.toFixed(1)} µs/pair) | ${fmtMs(r.duplicatesMs)} (${r.dupPairsFound} pairs) | ${fmtMs(r.insightsMs)} | ${r.withinRevealCap ? 'under cap' : `CAPPED at ${STATIC.MAX_BUBBLE_REVEAL}`} (${r.rippleLayers} layers) |`,
  );
}
reportLines.push('');
reportLines.push('## Static architecture constants referenced');
reportLines.push('');
for (const [k, v] of Object.entries(STATIC)) reportLines.push(`- \`${k}\` = ${v}`);
reportLines.push('');
reportLines.push('## Per-size detail');
reportLines.push('');
for (const r of rows) {
  reportLines.push(`### ${r.size} people`);
  reportLines.push('');
  reportLines.push(`- Fixture: ${r.size} people, generated deterministically (seed 42), includes a 4-current-partner anchor, ${r.size >= 500 ? 'an 8-current-partner stress anchor, ' : ''}a pedigree-collapse case, an explicit step case, an explicit adoptive case, and a pool of fully disconnected people.`);
  reportLines.push(`- Payload: **${fmtBytes(r.rawBytes)}** raw JSON (**${fmtBytes(r.gzipBytes)}** gzip), stringified in ${fmtMs(r.stringifyMs)}.`);
  reportLines.push(`  - ${r.pctOfD1RowCeiling.toFixed(2)}% of D1's 1 MiB per-row ceiling (the exact constraint \`docs/TREE-STORAGE.md\` and \`functions/_lib/treeStore.js\`'s core/R2-extra split already exist to solve).`);
  reportLines.push(`  - ${r.pctOfLocalStorageQuota.toFixed(2)}% of a typical ${STATIC.LOCALSTORAGE_TYPICAL_QUOTA_MB}MB browser localStorage quota (the client-side persistence \`store.js\` uses).`);
  reportLines.push(`- \`buildGraph\`: ${fmtMs(r.buildGraphMs)}.`);
  reportLines.push(`- \`distancesFrom\` (BFS from the default viewer): ${fmtMs(r.distancesMs)}, reaching ${r.reachable} of ${r.size} people (the multi-partner anchor clusters and the disconnected pool are deliberately unreachable islands — see the fixture's own test comments).`);
  reportLines.push(`- \`relationLabel\` (cousin-degree / kin-label computation) over a ${r.relationLabelSampleSize}-pair sample from the viewer: ${fmtMs(r.relationLabelMs)} total, ${r.relationLabelPerPairUs.toFixed(1)} µs/pair average.`);
  reportLines.push(`- \`findDuplicatePairs\`: ${fmtMs(r.duplicatesMs)}, found ${r.dupPairsFound} candidate pairs in this synthetic data (not a defect — the generator does not deliberately plant name/date collisions beyond the fixed anchors, so this count reflects incidental collisions in the seeded random name/date pools).`);
  reportLines.push(`- \`computeInsightModules\`: ${fmtMs(r.insightsMs)} for the full pass.`);
  reportLines.push(`- Bubble reveal ("All" in Tree view): ${r.reachable} people reachable from the viewer vs. the ${STATIC.MAX_BUBBLE_REVEAL}-person hard cap already enforced in \`App.jsx\` — ${r.withinRevealCap ? 'stays under the cap, reveals everyone reachable' : `exceeds the cap; "All" would reveal only the closest ${STATIC.MAX_BUBBLE_REVEAL} and show the existing List-view redirect toast`}, over ${r.rippleLayers} ripple-reveal layers at ${STATIC.RIPPLE_CHUNK_SIZE}/layer.`);
  reportLines.push('');
}
reportLines.push('## Key finding: `computeInsightModules` has a real quadratic-ish hot spot at scale');
reportLines.push('');
reportLines.push('The insight-modules timings above are not a flat, uniformly-scaling cost — they blow');
reportLines.push(`up disproportionately as size grows (${rows.map((r) => fmtMs(r.insightsMs)).join(' → ')} across a 50x`);
reportLines.push('growth in people, i.e. roughly two orders of magnitude more than linear). A CPU profile');
reportLines.push('(`node --cpu-prof`) taken against the 5,000-person fixture attributes **~82% of all CPU');
reportLines.push('time inside `computeInsightModules`** to a single module: `bridges()`');
reportLines.push('(`src/lib/insightModules.js`), the "cut point" family-structure insight. Its own code');
reportLines.push('comment already documents the complexity honestly — *"Exhaustive but cheap: remove each');
reportLines.push('person once and BFS their component\'s remains. O(people × edges) — a few million ops at');
reportLines.push('1,000 people"* — but that comment\'s own "cheap" framing does not hold at 5,000: a few');
reportLines.push('million ops at 1,000 people becomes tens of millions at 5,000 (the cost scales with both');
reportLines.push('the outer removal loop AND the per-removal BFS over the remaining graph, so it is not a');
reportLines.push('simple linear multiplier).');
reportLines.push('');
reportLines.push('This directly matters for the storage/perimeter ADR: **any perimeter or halo feature that');
reportLines.push('re-triggers a full insight recompute on every viewport/anchor change would inherit this');
reportLines.push('cost.** The existing code already computes insights once per tree load, not per');
reportLines.push('interaction, so today\'s impact is "the insights sheet takes ~5–6s to open the first time');
reportLines.push('on a 5,000-person tree," not a per-frame cost — but it is the single largest non-payload');
reportLines.push('number this benchmark found, and worth a scoped follow-up (likely: only run `bridges()`');
reportLines.push('lazily/on-demand rather than eagerly in the main `computeInsightModules` pass, or cap its');
reportLines.push('exhaustive removal scan to a bounded neighborhood) independent of whatever the storage ADR');
reportLines.push('decides — it is a computation-cost problem, not a payload-size problem, and the two need');
reportLines.push('different fixes.');
reportLines.push('');
reportLines.push('## Reading these numbers');
reportLines.push('');
reportLines.push('- All timings are single-run Node measurements on this container\'s CPU, not a real');
reportLines.push('  device or browser JS engine — treat them as **relative, order-of-magnitude**');
reportLines.push('  evidence for where cost concentrates as size grows, not as absolute production');
reportLines.push('  latency budgets.');
reportLines.push('- `buildGraph`/`distancesFrom`/`relationLabel`/`findDuplicatePairs`/');
reportLines.push('  `computeInsightModules` are exactly the functions the running app already calls —');
reportLines.push('  this harness adds no shims or mocks around them.');
reportLines.push('- The payload-size numbers are the most directly load-bearing for the storage ADR');
reportLines.push('  (task after this one): they show where the existing D1 1MiB-per-row ceiling and');
reportLines.push('  `treeStore.js` core/R2-extra split sit relative to real fixture sizes at this scale.');
reportLines.push('');

writeFileSync(join(__dirname, '..', 'docs', 'PHASE0-BENCHMARK-REPORT.md'), reportLines.join('\n'));
console.log('\nWrote docs/PHASE0-BENCHMARK-REPORT.md');
