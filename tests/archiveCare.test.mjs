/**
 * Unit tests for lib/archiveCare.js — the "seen" (not dismissed) tracking
 * behind the topbar's Archive Care notification dot (premium-UX brief:
 * show an indicator only for newly discovered review items, never a
 * permanent raw-total badge). Run with: node tests/archiveCare.test.mjs
 */
import assert from 'node:assert/strict';

// Plain Node has no global localStorage — set a real in-memory one before
// the module under test is imported (same convention as
// store-redundant-write.test.mjs).
const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, v),
  removeItem: (k) => backing.delete(k),
};

const { loadSeenArchiveCareKeys, saveSeenArchiveCareKeys, hasUnseenKeys } = await import('../src/lib/archiveCare.js');

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

test('loadSeenArchiveCareKeys returns an empty set with nothing stored', () => {
  backing.clear();
  const seen = loadSeenArchiveCareKeys();
  assert.ok(seen instanceof Set);
  assert.equal(seen.size, 0);
});

test('save then load round-trips the exact key set', () => {
  backing.clear();
  saveSeenArchiveCareKeys(new Set(['a:b', 'issue:1']));
  const seen = loadSeenArchiveCareKeys();
  assert.deepEqual([...seen].sort(), ['a:b', 'issue:1']);
});

test('loadSeenArchiveCareKeys degrades to empty on corrupt JSON', () => {
  backing.set('bl_archivecare_seen', '{not valid json');
  const seen = loadSeenArchiveCareKeys();
  assert.equal(seen.size, 0);
});

test('hasUnseenKeys is true when at least one key is unseen', () => {
  const seen = new Set(['a', 'b']);
  assert.equal(hasUnseenKeys(['a', 'c'], seen), true);
});

test('hasUnseenKeys is false when every key has already been seen', () => {
  const seen = new Set(['a', 'b', 'c']);
  assert.equal(hasUnseenKeys(['a', 'b'], seen), false);
});

test('hasUnseenKeys is false for an empty key list — nothing to notify about', () => {
  assert.equal(hasUnseenKeys([], new Set()), false);
});

test('hasUnseenKeys is true when nothing has ever been seen yet', () => {
  assert.equal(hasUnseenKeys(['x'], new Set()), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
