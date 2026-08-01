/**
 * Regression tests for _restoreEpoch — the fix for a real repeat incident
 * (docs/SAFETY.md "Destructive whole-tree operations"): a server-side
 * snapshot restore (or a client-side resetTree/Replace-import) correctly
 * fixes the LIVE server copy, but a DIFFERENT device that was already open
 * with its own stale local cache from before the fix has no way to know one
 * happened — its next ordinary sync merges its still-intact (but now-wrong)
 * local records/tombstones right back in via _mergeByRecency, silently
 * undoing the fix. This happened twice for real, once from a Safari tab
 * that had simply been left open.
 *
 * _restoreEpoch marks an authoritative reset; any device whose last-seen
 * epoch is behind the server's must take the server wholesale on its next
 * sync instead of merging. These tests prove that override actually beats
 * an ordinary recency-based merge outcome — the exact scenario that bit
 * production twice — not just that the field exists.
 *
 * Run with: node tests/restore-epoch.test.mjs
 */
import assert from 'node:assert/strict';
import {
  store, resetTree, importFromGedcom, enableServerSync, loadFromServer,
} from '../src/data/store.js';

let passed = 0, failed = 0;
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const person = (id, extra = {}) => ({ id, display_name: id, is_deceased: false, ...extra });

// ── resetTree / importFromGedcom replace stamp _restoreEpoch ───────────────

await atest('resetTree() stamps a fresh _restoreEpoch', async () => {
  importFromGedcom([person('a'), person('b')], [], { merge: false });
  const before = Date.now();
  resetTree();
  const epoch = store.getState()._restoreEpoch;
  assert.ok(typeof epoch === 'number' && epoch >= before, 'resetTree must stamp a fresh numeric epoch');
});

await atest('importFromGedcom replace mode stamps a fresh _restoreEpoch', async () => {
  const before = Date.now();
  importFromGedcom([person('x'), person('y')], [], { merge: false });
  const epoch = store.getState()._restoreEpoch;
  assert.ok(typeof epoch === 'number' && epoch >= before, 'a Replace import must stamp a fresh epoch — it\'s authoritative for every device, same as resetTree');
});

await atest('importFromGedcom MERGE mode does not touch _restoreEpoch (not an authoritative reset)', async () => {
  importFromGedcom([person('base')], [], { merge: false });
  const epochBefore = store.getState()._restoreEpoch;
  importFromGedcom([person('extra')], [], { merge: true });
  assert.equal(store.getState()._restoreEpoch, epochBefore, 'an incremental merge import must never bump the epoch');
});

// ── loadFromServer: the epoch override actually beats an ordinary merge ────
// This is the load-bearing property: prove that WITHOUT the epoch check, the
// scenario below would resolve the wrong way (local's genuinely-newer-looking
// record would win via _mergeByRecency), and that WITH it, the server's
// authoritative reset wins regardless of any local recency signal.

const realFetch = globalThis.fetch;
function mockFetch(serverTree) {
  globalThis.fetch = async (url, opts) => {
    if (!String(url).includes('/api/tree')) throw new Error(`unexpected fetch: ${url}`);
    if (opts?.method === 'PUT') {
      return { ok: true, headers: { get: (h) => (h === 'ETag' ? 'W/"saved"' : null) }, json: async () => ({}) };
    }
    return { ok: true, headers: { get: (h) => (h === 'ETag' ? 'W/"mock"' : null) }, json: async () => serverTree };
  };
}

await atest('a server _restoreEpoch newer than local\'s wins outright — local wholesale-replaced, ' +
  'even though a per-record recency merge would otherwise have kept local\'s "newer" data', async () => {
  // This device's local cache: a person edited very recently (a high
  // updated_at) — exactly what _mergeByRecency would normally let win.
  importFromGedcom([person('stale_survivor', { updated_at: Date.now() })], [], { merge: false });
  enableServerSync();

  // The server has since undergone an authoritative reset (a restore) that
  // does NOT include 'stale_survivor' at all, and carries a fresh epoch.
  const serverTree = {
    ...store.getState(),
    people: [person('restored_person')],
    relationships: [],
    _restoreEpoch: Date.now() + 10_000, // strictly newer than local's (undefined/0)
  };
  mockFetch(serverTree);

  await loadFromServer();
  const ids = store.getState().people.map((p) => p.id);
  assert.deepEqual(ids, ['restored_person'], 'server must win wholesale — no per-record merge, no resurrecting stale_survivor');
  assert.equal(store.getState()._restoreEpoch, serverTree._restoreEpoch, 'local must adopt the server\'s epoch so it doesn\'t re-trigger next sync');
});

await atest('without a newer server epoch, an ordinary merge still runs (regression guard: this fix is additive, not a behavior change for normal sync)', async () => {
  importFromGedcom([person('local_person', { updated_at: Date.now() })], [], { merge: false });
  enableServerSync();
  const serverTree = { ...store.getState(), people: [person('server_person')] }; // no _restoreEpoch at all
  mockFetch(serverTree);

  await loadFromServer();
  const ids = store.getState().people.map((p) => p.id).sort();
  assert.deepEqual(ids, ['local_person', 'server_person'], 'with no epoch signal, both sides\' unique people must be unioned as normal');
});

await atest('a server epoch equal to (not greater than) local\'s does not force a wholesale replace', async () => {
  importFromGedcom([person('mine')], [], { merge: false });
  const sameEpoch = store.getState()._restoreEpoch;
  enableServerSync();
  const serverTree = { ...store.getState(), people: [person('theirs')], _restoreEpoch: sameEpoch };
  mockFetch(serverTree);

  await loadFromServer();
  const ids = store.getState().people.map((p) => p.id).sort();
  assert.deepEqual(ids, ['mine', 'theirs'], 'equal epochs must merge normally, not wholesale-replace');
});

globalThis.fetch = realFetch;

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
