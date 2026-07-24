/*
 * Proves the exact PR #9 review finding stays fixed: this Worker is deployed
 * SEPARATELY from the main Pages project, so sendCompletionEmailStep's
 * env.APP_URL/env.FROM_EMAIL/env.BREVO_API_KEY (functions/_lib/util.js#sendEmail,
 * workflowSteps.js#sendCompletionEmailStep) are never inherited from the root
 * wrangler.toml just because they share an account — before this fix, this
 * file had no [vars] block at all, so every completion email would have
 * either silently no-op'd (missing BREVO_API_KEY, util.js's own dev fallback)
 * or thrown (missing FROM_EMAIL) on every single real deploy. This is a
 * static text check, not a real-deploy check (see the runbook's own §4a for
 * the documented human step for the actual secret), but it does prevent the
 * [vars] block from silently being deleted or left unfilled again.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const src = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const rootSrc = readFileSync(new URL('../../../wrangler.toml', import.meta.url), 'utf8');

function varValue(toml, key) {
  const m = toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return m ? m[1] : null;
}

test('workers/export-workflow/wrangler.toml declares a [vars] block', () => {
  assert.match(src, /^\[vars\]/m);
});

test('APP_URL and FROM_EMAIL are non-empty and match the root project\'s own values exactly', () => {
  const workerAppUrl = varValue(src, 'APP_URL');
  const workerFromEmail = varValue(src, 'FROM_EMAIL');
  const rootAppUrl = varValue(rootSrc, 'APP_URL');
  const rootFromEmail = varValue(rootSrc, 'FROM_EMAIL');
  assert.ok(workerAppUrl, 'APP_URL must be set');
  assert.ok(workerFromEmail, 'FROM_EMAIL must be set');
  assert.equal(workerAppUrl, rootAppUrl, 'APP_URL must match the root wrangler.toml — this is what the completion email links back to');
  assert.equal(workerFromEmail, rootFromEmail, 'FROM_EMAIL must match the root wrangler.toml');
});

test('BREVO_API_KEY provisioning is documented as a secret (not committed as a plain var)', () => {
  assert.match(src, /BREVO_API_KEY is a SECRET/);
  assert.match(src, /wrangler secret put BREVO_API_KEY/);
  assert.ok(!/^BREVO_API_KEY\s*=/m.test(src), 'BREVO_API_KEY must never be a committed plaintext var');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
