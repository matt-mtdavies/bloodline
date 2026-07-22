/**
 * Regression tests for the "Saving…" pill appearing on every single app
 * open, even when nothing local needed pushing. loadFromServer() used to
 * unconditionally re-PUT the merged tree after every load; hasUnsyncedContent
 * now gates that on whether the merge actually produced something the server
 * doesn't already have.
 *
 * The stakes here are data integrity, not just UI polish — a false "nothing
 * to sync" verdict would silently drop a real edit. These tests exist to
 * prove, field by field, that every kind of local-only content still
 * survives the check and still triggers a save; only a PROVEN exact match
 * ever skips one.
 *
 * Run with: node tests/sync-nosave.test.mjs
 */
import assert from 'node:assert/strict';
import {
  hasUnsyncedContent, store, importFromGedcom, enableServerSync,
  loadFromServer, syncStore,
} from '../src/data/store.js';

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
const base = () => ({
  people: [person('a'), person('b')],
  relationships: [{ id: 'r1', type: 'parent', from_person: 'a', to_person: 'b', qualifier: 'biological' }],
  memories: [],
  photos: [],
  documents: [],
  activity: [],
  hasCompletedOnboarding: true,
  familyName: 'Test Family',
  myPersonId: 'a',
  _deleted: {},
});

// ── hasUnsyncedContent: the actual risk area, tested field by field ────────

test('identical merged/server content -> nothing to sync', () => {
  const a = base();
  const b = { ...base() }; // deep-equal but a distinct object
  assert.equal(hasUnsyncedContent(a, b), false);
});

test('a locally-added person is detected', () => {
  const server = base();
  const merged = { ...base(), people: [...server.people, person('c')] };
  assert.equal(hasUnsyncedContent(merged, server), true);
});

test('a locally-changed field on an existing person is detected', () => {
  const server = base();
  const merged = { ...base(), people: [person('a', { occupation: 'Farmer' }), person('b')] };
  assert.equal(hasUnsyncedContent(merged, server), true);
});

test('a local-only relationship (not yet on the server) is detected', () => {
  const server = base();
  const merged = {
    ...base(),
    relationships: [...server.relationships, { id: 'r2', type: 'partner', from_person: 'a', to_person: 'b', partner_status: 'current' }],
  };
  assert.equal(hasUnsyncedContent(merged, server), true);
});

test('a memory only present locally is detected', () => {
  const server = base();
  const merged = { ...base(), memories: [{ id: 'm1', text: 'hello', person_id: 'a' }] };
  assert.equal(hasUnsyncedContent(merged, server), true);
});

test('a pending (not-yet-uploaded) local photo is detected', () => {
  const server = base();
  const merged = { ...base(), photos: [{ id: 'p1', src: 'data:image/png;base64,xxx', person_id: 'a' }] };
  assert.equal(hasUnsyncedContent(merged, server), true);
});

test('a pending (not-yet-uploaded) local document is detected', () => {
  const server = base();
  const merged = { ...base(), documents: [{ id: 'd1', src: 'data:application/pdf;base64,xxx', person_id: 'a' }] };
  assert.equal(hasUnsyncedContent(merged, server), true);
});

test('an activity event not yet on the server is detected', () => {
  const server = base();
  const merged = { ...base(), activity: [{ id: 'e1', type: 'person_updated', created_at: '2026-01-01T00:00:00Z' }] };
  assert.equal(hasUnsyncedContent(merged, server), true);
});

test('a local-only tombstone (a deletion the server does not know about) is detected', () => {
  const server = base();
  const merged = { ...base(), _deleted: { people: { zzz: 123 } } };
  assert.equal(hasUnsyncedContent(merged, server), true);
});

test('a locally-renamed family is detected', () => {
  const server = base();
  const merged = { ...base(), familyName: 'Renamed Family' };
  assert.equal(hasUnsyncedContent(merged, server), true);
});

test('local onboarding-completed flag flipping true is detected', () => {
  const server = { ...base(), hasCompletedOnboarding: false };
  const merged = { ...base(), hasCompletedOnboarding: true };
  assert.equal(hasUnsyncedContent(merged, server), true);
});

// ── The two deliberately-excluded fields ────────────────────────────────────

test('myPersonId differing ALONE (different viewer) does NOT trigger a save', () => {
  const server = { ...base(), myPersonId: 'a' };
  const merged = { ...base(), myPersonId: 'b' }; // a different family member's own resolved seat
  assert.equal(hasUnsyncedContent(merged, server), false);
});

test('_seq differing ALONE does NOT trigger a save', () => {
  const server = { ...base(), _seq: 5 };
  const merged = { ...base(), _seq: 41 };
  assert.equal(hasUnsyncedContent(merged, server), false);
});

// ── Fail-safe: never silently skip on an unexpected shape ──────────────────

test('a malformed/unexpected value falls back to "save it" rather than throwing or skipping', () => {
  // A circular reference would make JSON.stringify throw — must not cause a
  // silent "nothing to sync" verdict.
  const circular = {};
  circular.self = circular;
  const merged = { ...base(), people: circular };
  assert.equal(hasUnsyncedContent(merged, base()), true);
});

// ── Integration: loadFromServer actually wires this up correctly ──────────
// One end-to-end pass with a real mocked network round-trip — proving the
// real merge → hasUnsyncedContent → scheduleServerSave wiring behaves
// correctly, not just the helper in isolation. Counts actual PUT calls
// (waiting out the real 1.5s save debounce) rather than reading syncStatus,
// since syncStatus is shared module state that earlier fixture setup
// (importFromGedcom, itself a real edit) can also flip — an unambiguous
// "did a network write happen" is the only signal that can't be confused
// with test-fixture noise once server sync is enabled.
const realFetch = globalThis.fetch;
let putCalls = 0;
function mockFetch(serverTree) {
  globalThis.fetch = async (url, opts) => {
    if (!String(url).includes('/api/tree')) throw new Error(`unexpected fetch: ${url}`);
    if (opts?.method === 'PUT') {
      putCalls++;
      return { ok: true, headers: { get: (h) => (h === 'ETag' ? 'W/"saved"' : null) }, json: async () => ({}) };
    }
    return { ok: true, headers: { get: (h) => (h === 'ETag' ? 'W/"mock"' : null) }, json: async () => serverTree };
  };
}
const settle = () => new Promise((r) => setTimeout(r, 1700)); // outlasts the 1.5s save debounce

await atest('loadFromServer does NOT re-PUT when the server already matches local exactly', async () => {
  // Fixture set up BEFORE enableServerSync, so this commit can't itself
  // schedule a save and contaminate the count below.
  importFromGedcom([person('x'), person('y')], [], { merge: false });
  const serverSnapshot = { ...store.getState() };
  mockFetch(serverSnapshot);
  enableServerSync();
  putCalls = 0;
  await loadFromServer();
  await settle();
  assert.equal(putCalls, 0, 'a load that changed nothing must not trigger a network save');
});

await atest('loadFromServer DOES re-PUT when local has a person the server does not', async () => {
  // Server sync is already enabled (previous test) — this fixture commit
  // schedules its OWN save under the still-active mock; let it fully settle
  // before resetting the counter for the actual assertion below.
  importFromGedcom([person('solo')], [], { merge: false });
  await settle();
  // Simulate: this device has a person the server doesn't know about yet
  // (e.g. added while offline). Server returns an earlier snapshot.
  const staleServerSnapshot = { ...store.getState(), people: [] };
  mockFetch(staleServerSnapshot);
  putCalls = 0;
  await loadFromServer();
  await settle();
  assert.ok(putCalls >= 1, 'a genuinely-unsynced local person must still trigger a network save');
});

globalThis.fetch = realFetch;

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
