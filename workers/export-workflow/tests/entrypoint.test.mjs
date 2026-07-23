/*
 * Proves the exact PR #8 review fix holds: ExportWorkflowEntrypoint must
 * extend WorkerEntrypoint to be a valid RPC service-binding target. This
 * can't import entrypoint.js directly (it imports `cloudflare:workers`,
 * which doesn't exist under plain Node — see workflowSteps.js's own header
 * comment for why the Workflow logic itself lives in a separate file for
 * exactly this reason). Instead this statically inspects the source text
 * for the two properties that actually make a class a working RPC target:
 * importing WorkerEntrypoint from 'cloudflare:workers', and the
 * ExportWorkflowEntrypoint class declaration actually extending it. A
 * regression that reverts to a bare class (Phase A's original shape) would
 * fail this test immediately, without needing a live Cloudflare account.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const src = readFileSync(new URL('../src/entrypoint.js', import.meta.url), 'utf8');

test('entrypoint.js imports WorkerEntrypoint from cloudflare:workers', () => {
  assert.match(src, /import\s*\{[^}]*\bWorkerEntrypoint\b[^}]*\}\s*from\s*['"]cloudflare:workers['"]/);
});

test('ExportWorkflowEntrypoint actually extends WorkerEntrypoint (not a bare class)', () => {
  assert.match(src, /class\s+ExportWorkflowEntrypoint\s+extends\s+WorkerEntrypoint\b/);
});

test('FamilyArchiveExportWorkflow is exported from entrypoint.js (the wrangler.toml `main` colocation requirement)', () => {
  assert.match(src, /export\s*\{\s*FamilyArchiveExportWorkflow\s*\}/);
});

test('createExport/getExportInstance/requestCancellation are real methods, not Phase A "not implemented" stubs', () => {
  assert.ok(!/not implemented in Phase A/.test(src), 'the Phase A stub error text must be gone');
  for (const method of ['createExport', 'getExportInstance', 'requestCancellation']) {
    assert.match(src, new RegExp(`async ${method}\\(`));
  }
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
