/**
 * Phase 1 performance relief (docs/FAMILY-PERIMETER-AND-5000-PERSON-
 * PERFORMANCE.md §10, "protection against unnecessary full-state
 * serialization"): commit() now skips the actual localStorage.setItem call
 * when the newly-serialized state is byte-identical to what's already
 * stored — the real case this protects is loadFromServer's background poll
 * re-writing the exact same bytes to a large family's localStorage on every
 * quiet cycle. This only ever skips a PROVEN exact-string match; it must
 * never skip a genuine change.
 *
 * Run with: node tests/store-redundant-write.test.mjs
 */
import assert from 'node:assert/strict';

// Plain Node has no global localStorage (see store.js's own try/catch around
// every access, written specifically to degrade gracefully without one) —
// this test needs a REAL one to count actual write calls. Set before the
// first action below runs; store.js reads/writes localStorage lazily inside
// commit(), not at module-evaluation time, so this is safe to set here.
const backing = new Map();
let setItemCalls = 0;
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => { setItemCalls++; backing.set(k, v); },
  removeItem: (k) => backing.delete(k),
};

const { importFromGedcom, enableServerSync, loadFromServer, clearLocalData } = await import('../src/data/store.js');

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const person = (id, extra = {}) => ({ id, display_name: id, is_deceased: false, ...extra });

test('a real local edit always writes to localStorage', () => {
  setItemCalls = 0;
  importFromGedcom([person('a'), person('b')], [], { merge: false });
  assert.ok(setItemCalls >= 1, 'a genuine local edit must persist');
});

// Every LOCAL edit (fromServer: false) bumps _seq unconditionally — by
// design, each one is a genuinely distinct edit event worth recording even
// if the visible fields end up looking the same, so two "identical" local
// edits never actually produce byte-identical committed state. The skip
// only ever applies to fromServer:true commits (_seq passed through
// unchanged) — loadFromServer's own reconciliation path, tested below.

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
const settle = () => new Promise((r) => setTimeout(r, 1700)); // outlasts the 1.5s save debounce

await atest('a repeated loadFromServer against the same server snapshot only writes localStorage once', async () => {
  importFromGedcom([person('p1'), person('p2')], [], { merge: false });
  await settle();
  enableServerSync();
  await settle();

  mockFetch({});
  await loadFromServer(); // first load: writes whatever the merge produces
  await settle();

  setItemCalls = 0;
  await loadFromServer(); // second load against the SAME mocked server response
  await settle();
  assert.equal(setItemCalls, 0, 'a repeated load with unchanged server data must not re-write localStorage');
});

await atest('logout, then a same-account re-login whose content matches what was cleared, must still restore the local cache', async () => {
  // Real bug this reproduces (PR #86 review): clearLocalData() removes the
  // cached tree from localStorage but, before the fix, left
  // lastSerializedToStorage pointing at the pre-logout content. If the very
  // next load reconciles to byte-identical content (plausible on a
  // same-account re-login with an unchanged tree), the redundant-write skip
  // would fire even though there is nothing in localStorage to be
  // redundant WITH — state stays correct in memory, but the on-disk local/
  // offline cache silently never comes back.
  importFromGedcom([person('q1'), person('q2')], [], { merge: false });
  await settle();
  assert.ok(backing.size > 0, 'sanity: something was cached before logout');
  const preLogoutEntries = new Map(backing);
  const treeKey = [...preLogoutEntries.keys()].find((k) => {
    try { return JSON.parse(preLogoutEntries.get(k))?.people?.some((p) => p.id === 'q1'); }
    catch { return false; }
  });
  assert.ok(treeKey, 'sanity: found the actual tree cache entry before logout');

  clearLocalData();
  assert.equal(backing.has(treeKey), false, 'sanity: logout actually removed the cached tree from localStorage');

  // The server still has exactly what was just cleared.
  const serverSnapshot = JSON.parse(preLogoutEntries.get(treeKey));
  mockFetch(serverSnapshot);
  setItemCalls = 0;
  await loadFromServer({ forceServerWins: true });
  await settle();
  assert.ok(setItemCalls >= 1, 'a load right after logout must write the local cache back, even if its content matches what was just cleared');
  assert.ok(backing.has(treeKey), 'the local/offline cache must actually exist again after re-login');
});

await atest('a genuinely different server snapshot still writes localStorage', async () => {
  mockFetch({ people: [person('genuinely-new')], relationships: [], memories: [], photos: [], documents: [], activity: [], hasCompletedOnboarding: true, familyName: 'X', myPersonId: 'genuinely-new', _deleted: {} });
  setItemCalls = 0;
  await loadFromServer();
  await settle();
  assert.ok(setItemCalls >= 1, 'genuinely different content must still persist — this optimization must never mask a real change');
});

globalThis.fetch = realFetch;

console.log(`\n  ${passed} passed, ${failed} failed`);
// enableServerSync() arms a recurring background-poll timer that would
// otherwise keep this script's event loop alive indefinitely — force a
// clean exit once every assertion above has actually run.
process.exit(failed ? 1 : 0);
