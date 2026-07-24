import assert from 'node:assert/strict';
import { buildMissingFilesReport, buildIntegrityReportHtml } from '../src/lib/reports.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('buildMissingFilesReport reports a clean archive plainly when there are no warnings', () => {
  const text = buildMissingFilesReport([]);
  assert.match(text, /No missing, unreadable, or unsupported files/);
});

test('buildMissingFilesReport lists every warning with its path, status, and reason', () => {
  const text = buildMissingFilesReport([
    { path: 'photos/p1.jpg', status: 'missing', warning: 'missing' },
    { path: 'documents/d1.pdf', status: 'unreadable', warning: 'R2 read failed' },
  ]);
  assert.match(text, /2 file\(s\)/);
  assert.match(text, /photos\/p1\.jpg/);
  assert.match(text, /status: missing/);
  assert.match(text, /documents\/d1\.pdf/);
  assert.match(text, /reason: R2 read failed/);
});

test('buildIntegrityReportHtml embeds the manifest status, entry/warning counts, and manifest checksum', () => {
  const html = buildIntegrityReportHtml({
    manifest: { status: 'ready_with_warnings', files: [{ path: 'a' }, { path: 'b' }], warnings: [{ path: 'photos/p1.jpg', status: 'missing', warning: 'missing' }] },
    manifestChecksum: 'abc123',
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.match(html, /ready_with_warnings/);
  assert.match(html, /Entries: 2/);
  assert.match(html, /Warnings: 1/);
  assert.match(html, /abc123/);
  assert.match(html, /photos\/p1\.jpg/);
});

test('buildIntegrityReportHtml never claims a whole-archive checksum it cannot possibly know yet', () => {
  const html = buildIntegrityReportHtml({
    manifest: { status: 'ready', files: [], warnings: [] },
    manifestChecksum: 'abc123',
    generatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.match(html, /recorded in the family's export\nhistory in Bloodline/);
});

test('buildIntegrityReportHtml escapes HTML-unsafe characters in warning text (no injection)', () => {
  const html = buildIntegrityReportHtml({
    manifest: { status: 'ready_with_warnings', files: [], warnings: [{ path: '<script>alert(1)</script>', status: 'missing', warning: '<b>bad</b>' }] },
    manifestChecksum: 'x',
    generatedAt: 'x',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
