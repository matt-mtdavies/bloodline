/*
 * Canopy visual harness — renders the view against a REPRESENTATIVE family,
 * never the 23-person demo seed.
 *
 * Standing instruction from the repo owner: always test on real tree data or
 * a representative data set. The demo seed is a 23-person hand-built family;
 * it cannot show what a frame looks like when someone has four partners, a
 * blended household, or ancestors who married cousins — and two fixes have
 * already shipped green against it and failed on the real 1,200-person tree.
 *
 * So this uses lib/fixtureGenerator.js at 1,200 people: deterministic, and
 * built to contain remarriage, step/adoptive edges, pedigree collapse,
 * multi-partner anchors, and a realistic mix of rich and sparse profiles.
 * Three focus people are rendered (a multi-partner anchor, a large family,
 * and the fixture's own default) at desktop and mobile.
 *
 *   node tests/canopy-visual.mjs          # with stand-in portraits
 *   PHOTOS=0 node tests/canopy-visual.mjs # monograms only
 *   SIZE=400 node tests/canopy-visual.mjs # smaller fixture
 *
 * Screenshots land in /tmp/big-<focus>-<viewport>.png. Requires the dev
 * server (npm run dev) on :5173. Loaded via ?new, which reads the tree from
 * localStorage — ?demo would override it with the seed family.
 */
import { chromium } from 'playwright';
import { generateFamilyFixture } from '../src/lib/fixtureGenerator.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173/?new';
const SIZE = Number(process.env.SIZE || 1200);

const run = async () => {
  const { tree: fx, meta } = generateFamilyFixture({ size: SIZE, seed: 7 });

  /* Stand-in portraits. The fixture has no photos and the sandbox blocks the
   * demo seed's external faces, so every render so far has been monograms —
   * which is NOT the real case: this design lives on faces. These are simple
   * deterministic SVG portraits (a warm ground, a head-and-shoulders
   * silhouette) inlined as data URIs, enough to judge how the rings, shadows
   * and scale behave with photographic content in the discs. */
  const GROUNDS = ['#8d7f6e', '#7d8a72', '#9a8570', '#79837f', '#94807a', '#87826f'];
  const portrait = (i) => {
    const g = GROUNDS[i % GROUNDS.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">`
      + `<rect width="240" height="240" fill="${g}"/>`
      + `<circle cx="120" cy="96" r="46" fill="rgba(255,252,246,0.86)"/>`
      + `<path d="M32 240c0-52 40-84 88-84s88 32 88 84z" fill="rgba(255,252,246,0.86)"/>`
      + `</svg>`;
    return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  };
  if (process.env.PHOTOS !== '0') {
    fx.people.forEach((p, i) => { if (i % 4 !== 3) p.photo = portrait(i); });
  }
  // Pick focus people with genuinely different shapes to stress the frame.
  const withPartners = fx.people.filter((p) =>
    fx.relationships.filter((r) => r.type === 'partner' && (r.from_person === p.id || r.to_person === p.id)).length >= 2);
  const withKids = fx.people.filter((p) =>
    fx.relationships.filter((r) => r.type === 'parent' && r.from_person === p.id).length >= 3);
  const targets = [
    ['multi-partner', withPartners[0]?.id],
    ['big-family', withKids[0]?.id],
    ['default', fx.myPersonId || fx.people[0].id],
  ].filter(([, id]) => id);

  console.log(`fixture: ${fx.people.length} people, ${fx.relationships.length} relationships`);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const [label, personId] of targets) {
    for (const [vpName, vp] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2 });
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION|500 \(/.test(m.text())) errs.push(m.text()); });
      await page.addInitScript(([tree, pid]) => {
        window.localStorage.setItem('bloodline:v1', JSON.stringify(tree));
        window.localStorage.setItem('bl_canopy_enabled', '1');
        window.__focusPerson = pid;
      }, [fx, personId]);
      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.waitForSelector('.canopy-host', { timeout: 20000 });
      await page.waitForTimeout(4500);
      await page.screenshot({ path: `/tmp/big-${label}-${vpName}.png` });
      if (errs.length) console.log(`${label}/${vpName} errors:`, errs.slice(0, 3));
      else console.log(`${label}/${vpName} clean`);
      await page.close();
    }
  }
  await browser.close();
};
run().catch((e) => { console.error(e); process.exit(1); });
