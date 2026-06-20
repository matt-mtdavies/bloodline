/**
 * Generates PWA + apple-touch PNG icons from the Bloodline SVG mark.
 * Run: node tests/_gen_icons.mjs
 * Output: public/icon-{192,512,maskable-192,maskable-512,apple-touch}.png
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';

// Standard icon — tight padding, matches favicon.svg shape
const iconSvg = (size) => {
  const s = size;
  // All coords relative to a 100x100 viewBox, scaled to `size`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${Math.round(100 * 14 / 64)}" fill="#f7f3ec"/>
  <!-- terracotta person (left) -->
  <circle cx="36" cy="36" r="14" fill="#c2603a"/>
  <path d="M18 74c0-10 8-16 18-16s18 6 18 16" fill="none" stroke="#c2603a" stroke-width="5" stroke-linecap="round"/>
  <!-- forest person (right) -->
  <circle cx="64" cy="36" r="14" fill="#3f5e4e"/>
  <path d="M46 74c0-10 8-16 18-16s18 6 18 16" fill="none" stroke="#3f5e4e" stroke-width="5" stroke-linecap="round"/>
</svg>`;
};

// Maskable icon — content scaled to 72% to stay within the safe zone
const maskableSvg = (size) => {
  const s = size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#f7f3ec"/>
  <!-- content scaled to 72% of icon, centred -->
  <g transform="translate(14,12) scale(0.72)">
    <circle cx="36" cy="36" r="14" fill="#c2603a"/>
    <path d="M18 74c0-10 8-16 18-16s18 6 18 16" fill="none" stroke="#c2603a" stroke-width="5" stroke-linecap="round"/>
    <circle cx="64" cy="36" r="14" fill="#3f5e4e"/>
    <path d="M46 74c0-10 8-16 18-16s18 6 18 16" fill="none" stroke="#3f5e4e" stroke-width="5" stroke-linecap="round"/>
  </g>
</svg>`;
};

// Apple touch icon — rounded corners baked in, slightly larger type
const appleSvg = (size) => {
  const s = size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#f7f3ec"/>
  <circle cx="36" cy="36" r="14" fill="#c2603a"/>
  <path d="M18 74c0-10 8-16 18-16s18 6 18 16" fill="none" stroke="#c2603a" stroke-width="5" stroke-linecap="round"/>
  <circle cx="64" cy="36" r="14" fill="#3f5e4e"/>
  <path d="M46 74c0-10 8-16 18-16s18 6 18 16" fill="none" stroke="#3f5e4e" stroke-width="5" stroke-linecap="round"/>
</svg>`;
};

const browser = await chromium.launch({ headless: true });

async function svgToPng(svgString, size) {
  const ctx = await browser.newContext({ viewport: { width: size, height: size } });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html><head><style>*{margin:0;padding:0;overflow:hidden}</style></head><body>${svgString}</body></html>`);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, type: 'png' });
  await ctx.close();
  return buf;
}

const jobs = [
  { name: 'public/icon-192.png',          svg: iconSvg(192),         size: 192 },
  { name: 'public/icon-512.png',          svg: iconSvg(512),         size: 512 },
  { name: 'public/icon-maskable-192.png', svg: maskableSvg(192),     size: 192 },
  { name: 'public/icon-maskable-512.png', svg: maskableSvg(512),     size: 512 },
  { name: 'public/apple-touch-icon.png',  svg: appleSvg(180),        size: 180 },
];

for (const { name, svg, size } of jobs) {
  const buf = await svgToPng(svg, size);
  writeFileSync(name, buf);
  console.log(`✓ ${name} (${size}×${size})`);
}

await browser.close();
console.log('All icons generated.');
