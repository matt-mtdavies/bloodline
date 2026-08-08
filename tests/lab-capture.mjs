/*
 * Tree Motion Lab capture harness.
 *
 *   npm run lab:capture                       # every fixture, both engines
 *   FIXTURES=remarried,three-pod npm run lab:capture
 *   BASE_URL=http://localhost:5173/ npm run lab:capture
 *
 * Produces, under tests/lab-capture/ (gitignored):
 *   <fixture>-<engine>-t{0,150,400,900,2000}.png   timed frames of one transition
 *   <fixture>-<engine>.webm                        video of the same transition
 *   metrics.json                                   every run's motion summary
 *   REPORT.md                                      the side-by-side table
 *
 * The timings are fixed rather than "wait until it looks done" on purpose: the
 * claim under review is about what a person SEES at a given moment after
 * clicking, so the evidence has to be sampled on a clock, and the same clock
 * every time so two runs are comparable.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.BASE_URL || 'http://localhost:5173/').replace(/\/$/, '');
const OUT = 'tests/lab-capture';
const SAMPLES_MS = [0, 150, 400, 900, 2000];
const ENGINES = (process.env.ENGINES || 'v1,v2').split(',');

const brief = {
  nuclear: 'n_c',
  remarried: 'r_jason',
  'three-pod': 't_k2',
  'wide-siblings': 'w_s8',
  'deep-lineage': 'd_g1',
  'distant-pull': 'x_kid1',
  disconnected: 'y_a3',
  singleton: 's_only',
};

const wanted = process.env.FIXTURES ? process.env.FIXTURES.split(',') : Object.keys(brief);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];
let failures = 0;

for (const fixtureId of wanted) {
  const target = brief[fixtureId];
  if (!target) { console.log(`  ! unknown fixture "${fixtureId}" — skipped`); continue; }

  for (const engine of ENGINES) {
    const label = `${fixtureId}-${engine}`;
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2,
      recordVideo: { dir: path.join(OUT, 'video-raw'), size: { width: 1280, height: 900 } },
    });
    const page = await context.newPage();
    const errors = [];
    // Same filter as tests/smoke.mjs: a blocked EXTERNAL resource (the Google
    // Fonts stylesheet, a portrait CDN) is a sandbox network-policy fact, not
    // a fault in what is being measured. Real exceptions still count.
    const isExternalResourceError = (t) =>
      /Failed to load resource|net::ERR_|ERR_CERT_|Access-Control-Allow-Origin|access control checks/.test(t);
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !isExternalResourceError(m.text())) errors.push(m.text());
    });

    try {
      await page.goto(`${BASE}/?lab=tree-motion&treePhysics=${engine}`, { waitUntil: 'load', timeout: 25000 });
      await page.waitForSelector('[data-testid="lab-stage"]', { timeout: 15000 });
      await page.selectOption('[data-testid="fixture-select"]', fixtureId);
      // Let the first composition land before the transition under test.
      await page.waitForTimeout(1500);

      await page.screenshot({ path: path.join(OUT, `${label}-before.png`) });

      // Trigger the transition through the lab's own API so the click point
      // (and therefore the anchor) is exactly reproducible run to run.
      const started = await page.evaluate((id) => {
        window.__treeMotionLab.select(id);
        return performance.now();
      }, target);

      for (const at of SAMPLES_MS) {
        const elapsed = await page.evaluate((s) => performance.now() - s, started);
        const wait = at - elapsed;
        if (wait > 0) await page.waitForTimeout(wait);
        await page.screenshot({ path: path.join(OUT, `${label}-t${at}.png`) });
      }

      await page.waitForTimeout(1200);
      const summary = await page.evaluate(() => ({
        summary: window.__treeMotionLab.summary(),
        settled: window.__treeMotionLab.isSettled(),
      }));

      results.push({ fixture: fixtureId, engine, target, ...summary, errors });
      if (errors.length) failures++;
      console.log(`  ✓ ${label}  settled=${summary.settled}  ${summary.summary
        ? `settleMs=${summary.summary.settleMs} drift=${summary.summary.maxActiveDriftPx}px rebound=${summary.summary.reboundFrames}`
        : ''}`);
    } catch (e) {
      failures++;
      results.push({ fixture: fixtureId, engine, target, error: e.message });
      console.log(`  ✗ ${label}: ${e.message}`);
    } finally {
      const video = page.video();
      await context.close();               // finalises the video file
      if (video) {
        try { await video.saveAs(path.join(OUT, `${label}.webm`)); } catch { /* nothing recorded */ }
      }
    }
  }
}

await browser.close();
await rm(path.join(OUT, 'video-raw'), { recursive: true, force: true });
await writeFile(path.join(OUT, 'metrics.json'), JSON.stringify(results, null, 2));

/* ── The comparison table a reviewer actually reads ───────────────────────── */
const cell = (r, k) => (r.summary ? r.summary[k] ?? '—' : '—');
const rows = results.map((r) => `| ${r.fixture} | ${r.engine} | ${r.settled ? 'yes' : 'no'} | ${cell(r, 'settleMs')} | ${cell(r, 'maxActiveDriftPx')} | ${cell(r, 'totalActiveDriftPx')} | ${cell(r, 'peakSpeed')} | ${cell(r, 'reboundFrames')} | ${cell(r, 'maxCollisionPush')} | ${r.errors?.length ?? 0} |`);

await writeFile(path.join(OUT, 'REPORT.md'), [
  '# Tree Motion Lab — recorded fixture comparison',
  '',
  `Captured against \`${BASE}\` at ${new Date().toISOString()}.`,
  '',
  'Each row is one scripted transition: the fixture loads, settles, then a named',
  'person is selected and the run is sampled at a fixed clock.',
  '',
  '| fixture | engine | settled | settle ms | max active drift px/frame | total active drift px | peak speed | rebound frames | max collision push | console errors |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
  '**How to read this.** `max active drift` is how far the person you just',
  'selected moved on screen in a single frame — the headline claim is that V2',
  'holds it at exactly 0 while V1 does not. `settled` / `settle ms` is whether',
  'macro motion actually stopped, and how long it took. `rebound frames` counts',
  'frames where MORE nodes were moving than the frame before, which is the',
  'signature of a layout still arguing with itself.',
  '',
  `Screenshots are sampled at ${SAMPLES_MS.join(', ')} ms after selection, plus a`,
  '`-before` frame, and each run has a matching `.webm`.',
  '',
].join('\n'));

console.log(`\nWrote ${results.length} runs to ${OUT}/ (metrics.json, REPORT.md, screenshots, video).`);
if (failures) { console.log(`${failures} run(s) reported errors — see metrics.json.`); process.exit(1); }
