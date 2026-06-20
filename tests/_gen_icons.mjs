/**
 * Generates PWA + apple-touch PNG icons from the Bloodline three-circle Logo mark.
 * Run: node tests/_gen_icons.mjs
 * Output: public/icon-{192,512,maskable-192,maskable-512,apple-touch}.png
 *
 * Uses deviceScaleFactor:2 for 2× rendering then downsamples to the target
 * size, giving crisper anti-aliasing.
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';

// Brand colours — vivid, not washed out
const TERRA  = '#c2603a';
const FOREST = '#3a6454';   // slightly richer than #3f5e4e
const GOLD   = '#b08642';
const BG     = '#f5ede2';   // slightly richer than #f7f3ec
const RING   = BG;          // knockout ring matches background

/**
 * Three-circle Logo mark centred in a square canvas.
 * `scale` controls how much of the canvas the mark fills (0–1).
 * `rounded` adds a squircle clip (for standard icon; not for maskable).
 */
function logoSvg(size, { scale = 0.72, rounded = true } = {}) {
  const r  = size / 2;                     // canvas radius
  const rx = rounded ? Math.round(size * 0.22) : 0;

  // Mark natural bounding box in Logo.jsx viewBox (42×40):
  // A: cx=15,cy=17,r=10  B: cx=27,cy=17,r=10  C: cx=21,cy=29,r=6.6
  // Tight bbox: x=5..37 (32w), y=7..35.6 (28.6h) → centred at 21,21.3

  // We want the mark to fit in a circle of radius (r * scale)
  const markHalfW = 16;   // half of 32w in viewBox units
  const markHalfH = 14.3; // half of 28.6h
  const sf = (r * scale) / Math.max(markHalfW, markHalfH);

  const cx = r;   // canvas centre x
  const cy = r;   // canvas centre y

  // Transform each circle centre from viewBox to canvas coords:
  // viewBox centre of mark: (21, 21.3)
  const tx = (vx) => cx + (vx - 21) * sf;
  const ty = (vy) => cy + (vy - 21.3) * sf;

  const rA = 10 * sf;
  const rB = 10 * sf;
  const rC = 6.6 * sf;
  const sw = Math.max(2, sf * 2.4);  // stroke-width proportional to scale

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="${BG}"/>
  <circle cx="${tx(15).toFixed(1)}" cy="${ty(17).toFixed(1)}" r="${rA.toFixed(1)}" fill="${TERRA}"  stroke="${RING}" stroke-width="${sw.toFixed(1)}"/>
  <circle cx="${tx(27).toFixed(1)}" cy="${ty(17).toFixed(1)}" r="${rB.toFixed(1)}" fill="${FOREST}" stroke="${RING}" stroke-width="${sw.toFixed(1)}"/>
  <circle cx="${tx(21).toFixed(1)}" cy="${ty(29).toFixed(1)}" r="${rC.toFixed(1)}" fill="${GOLD}"   stroke="${RING}" stroke-width="${sw.toFixed(1)}"/>
</svg>`;
}

const browser = await chromium.launch({ headless: true });

async function svgToPng(svgString, size) {
  // Render at 2× then screenshot at target size for crisp anti-aliasing
  const dpr = 2;
  const ctx = await browser.newContext({
    viewport: { width: size * dpr, height: size * dpr },
    deviceScaleFactor: dpr,
  });
  const page = await ctx.newPage();
  await page.setContent(
    `<!doctype html><html><head><style>*{margin:0;padding:0;overflow:hidden}` +
    `body{width:${size}px;height:${size}px;background:transparent}</style></head>` +
    `<body>${svgString}</body></html>`
  );
  // Screenshot at logical size (browser scales up to dpr internally)
  const buf = await page.screenshot({
    clip: { x: 0, y: 0, width: size, height: size },
    type: 'png',
    omitBackground: false,
  });
  await ctx.close();
  return buf;
}

const jobs = [
  { name: 'public/icon-192.png',          size: 192, opts: { scale: 0.68, rounded: true  } },
  { name: 'public/icon-512.png',          size: 512, opts: { scale: 0.68, rounded: true  } },
  { name: 'public/icon-maskable-192.png', size: 192, opts: { scale: 0.50, rounded: false } },
  { name: 'public/icon-maskable-512.png', size: 512, opts: { scale: 0.50, rounded: false } },
  { name: 'public/apple-touch-icon.png',  size: 180, opts: { scale: 0.65, rounded: false } },
];

for (const { name, size, opts } of jobs) {
  const svg = logoSvg(size, opts);
  const buf = await svgToPng(svg, size);
  writeFileSync(name, buf);
  console.log(`✓ ${name} (${size}×${size})`);
}

await browser.close();
console.log('All icons generated.');
