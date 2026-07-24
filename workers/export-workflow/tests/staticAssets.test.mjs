/*
 * Proves the generated static-viewer bundle (scripts/generateStaticAssets.mjs
 * -> src/lib/staticViewerAssets.generated.js -> src/lib/staticAssets.js)
 * decodes byte-identically to the real on-disk files — this is the exact
 * PR #9 review finding that the archive plan never bundled the viewer at
 * all (START-HERE.html, viewer/app.js, viewer/styles.css, fonts, license
 * files never appeared anywhere in the packaged ZIP).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStaticViewerFiles } from '../src/lib/staticAssets.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '../src');

const EXPECTED_PATHS = [
  'START-HERE.html', 'README.txt', 'viewer/app.js', 'viewer/styles.css', 'viewer/logo.svg',
  'viewer/fonts/fraunces-latin-400.woff2', 'viewer/fonts/fraunces-latin-600.woff2',
  'viewer/fonts/hanken-grotesk-latin-400.woff2', 'viewer/fonts/hanken-grotesk-latin-600.woff2',
  'viewer/licenses/Fraunces-OFL.txt', 'viewer/licenses/Hanken-Grotesk-OFL.txt',
];

test('getStaticViewerFiles returns exactly the 11 files docs/FULL-ARCHIVE-EXPORT.md §3.2 lists for the archive root + viewer — the PR #9 re-review finding that README.txt/viewer/logo.svg were missing', () => {
  const files = getStaticViewerFiles();
  assert.deepEqual(files.map((f) => f.path).sort(), [...EXPECTED_PATHS].sort());
});

test('every decoded file is byte-identical to the real file on disk', () => {
  const files = getStaticViewerFiles();
  const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
  for (const archivePath of EXPECTED_PATHS) {
    const real = readFileSync(path.join(SRC_DIR, archivePath));
    const decoded = byPath[archivePath];
    assert.equal(decoded.byteLength, real.byteLength, `${archivePath} byte length mismatch`);
    assert.ok(Buffer.from(decoded.bytes).equals(real), `${archivePath} content mismatch`);
  }
});

test('font files (already-compressed woff2) are marked store, not deflate-raw', () => {
  const files = getStaticViewerFiles();
  const fonts = files.filter((f) => f.path.endsWith('.woff2'));
  assert.ok(fonts.length > 0);
  for (const f of fonts) assert.equal(f.compress, 'store');
});

test('text assets (html/css/js/txt) are marked deflate-raw', () => {
  const files = getStaticViewerFiles();
  const texts = files.filter((f) => !f.path.endsWith('.woff2'));
  assert.ok(texts.length > 0);
  for (const f of texts) assert.equal(f.compress, 'deflate-raw');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
