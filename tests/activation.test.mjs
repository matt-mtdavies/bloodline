/**
 * Unit tests for src/lib/activation.js — the client-side fire-and-forget
 * telemetry helper (docs/PRODUCTIZATION-BRIEF.md §11.7). Verifies it prefers
 * sendBeacon, falls back to fetch when unavailable, never throws, and never
 * includes a `path` key in the payload unless one was actually passed.
 * Run with: node tests/activation.test.mjs
 */
import assert from 'node:assert/strict';
import { trackActivation } from '../src/lib/activation.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => { passed++; console.log(`PASS  ${label}`); })
        .catch((e) => { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); });
    }
    passed++; console.log(`PASS  ${label}`);
  } catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
  return Promise.resolve();
}

const originalNavigator = globalThis.navigator;
const originalFetch = globalThis.fetch;

// Node's built-in `navigator` global is a getter-only accessor property, so
// a plain `globalThis.navigator = ...` throws — redefine it instead.
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

function restore() {
  setNavigator(originalNavigator);
  globalThis.fetch = originalFetch;
}

await test('uses navigator.sendBeacon when available, with a JSON payload', () => {
  const calls = [];
  setNavigator({
    sendBeacon: (url, blob) => { calls.push({ url, blob }); return true; },
  });
  globalThis.fetch = () => { throw new Error('fetch should not be called'); };
  trackActivation('cta_click');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/activation-event');
  restore();
});

await test('includes path only when one is passed', () => {
  const captured = [];
  setNavigator({
    sendBeacon: (url, blob) => { captured.push(blob); return true; },
  });
  trackActivation('cta_click');
  trackActivation('path_chosen', 'import');
  restore();
  return Promise.all(captured.map((b) => b.text())).then(([noPath, withPath]) => {
    assert.deepEqual(JSON.parse(noPath), { event: 'cta_click' });
    assert.deepEqual(JSON.parse(withPath), { event: 'path_chosen', path: 'import' });
  });
});

await test('falls back to fetch with keepalive when sendBeacon is unavailable', () => {
  const calls = [];
  setNavigator({});
  globalThis.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve(); };
  trackActivation('onboarding_completed', 'fresh');
  restore();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/activation-event');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.keepalive, true);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { event: 'onboarding_completed', path: 'fresh' });
});

await test('never throws even if both navigator and fetch are broken', () => {
  setNavigator({ sendBeacon: () => { throw new Error('blocked'); } });
  globalThis.fetch = () => { throw new Error('also blocked'); };
  assert.doesNotThrow(() => trackActivation('tree_created'));
  restore();
});

await test('falls back to fetch if sendBeacon returns false (browser rejected the queued send)', () => {
  const calls = [];
  setNavigator({ sendBeacon: () => false });
  globalThis.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve(); };
  trackActivation('first_contribution');
  restore();
  assert.equal(calls.length, 1);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
