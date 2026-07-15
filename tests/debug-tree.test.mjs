/**
 * Unit tests for functions/api/debug/tree.js — the read-only diagnostic,
 * extended (docs/TREE-STORAGE.md Phase 0) with a byte breakdown per
 * top-level key and a per-person core/extra split, so the actual split
 * boundary in Phase 2 gets chosen from real numbers rather than guesswork.
 * Run with: node tests/debug-tree.test.mjs
 */
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/debug/tree.js';

let passed = 0, failed = 0;
async function test(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function makeFakeDB({ userRow, membershipRow, familyRow, treeRow }) {
  function stmt(sql) {
    let args = [];
    return {
      bind(...a) { args = a; return this; },
      async first() {
        if (/FROM user WHERE id/.test(sql)) return userRow ?? null;
        if (/FROM family_member WHERE user_id = \? AND family_id/.test(sql)) return membershipRow ?? null;
        if (/FROM family_member WHERE user_id/.test(sql)) return membershipRow ?? null;
        if (/FROM family WHERE id/.test(sql)) return familyRow ?? null;
        if (/FROM family_tree WHERE family_id/.test(sql)) return treeRow ?? null;
        return null;
      },
    };
  }
  return { prepare: (sql) => stmt(sql) };
}

const USER = { uid: 'u1' };
const USER_ROW = { id: 'u1', email: 'a@b.com', family_id: 'fam1' };
const MEMBERSHIP = { family_id: 'fam1', role: 'owner' };
const FAMILY = { id: 'fam1', name: 'The Test Family' };

await test('unauthed request → 401; no DB → 503', async () => {
  assert.equal((await onRequestGet({ env: { DB: makeFakeDB({}) }, data: {} })).status, 401);
  assert.equal((await onRequestGet({ env: {}, data: { user: USER } })).status, 503);
});

await test('no user row → ok:false, user_not_found', async () => {
  const db = makeFakeDB({ userRow: null });
  const res = await onRequestGet({ env: { DB: db }, data: { user: USER } });
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.issue, 'user_not_found');
});

await test('no membership → ok:false, no_family_membership', async () => {
  const db = makeFakeDB({ userRow: USER_ROW, membershipRow: null });
  const res = await onRequestGet({ env: { DB: db }, data: { user: USER } });
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.issue, 'no_family_membership');
});

await test('no family_tree row yet → ok:true, tree_exists false, no breakdown, no crash', async () => {
  const db = makeFakeDB({ userRow: USER_ROW, membershipRow: MEMBERSHIP, familyRow: FAMILY, treeRow: null });
  const res = await onRequestGet({ env: { DB: db }, data: { user: USER } });
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.tree_exists, false);
  assert.equal(body.tree_size_bytes, null);
  assert.equal(body.breakdown, null);
});

await test('corrupt tree_json still reports byte size, skips breakdown instead of crashing', async () => {
  const treeRow = { tree_json: '{not valid json', updated_at: 1000 };
  const db = makeFakeDB({ userRow: USER_ROW, membershipRow: MEMBERSHIP, familyRow: FAMILY, treeRow });
  const res = await onRequestGet({ env: { DB: db }, data: { user: USER } });
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.tree_size_bytes > 0, 'raw byte length should still be reported');
  assert.equal(body.breakdown, null);
});

await test('byte size matches TextEncoder, not character count, for non-ASCII content', async () => {
  // 'é' is 1 UTF-16 code unit / 1 JS string char but 2 UTF-8 bytes — a
  // regression to SQL LENGTH()-style character counting would under-report.
  const tree = { people: [{ id: 'p1', display_name: 'André' }] };
  const treeJson = JSON.stringify(tree);
  const treeRow = { tree_json: treeJson, updated_at: 1000 };
  const db = makeFakeDB({ userRow: USER_ROW, membershipRow: MEMBERSHIP, familyRow: FAMILY, treeRow });
  const res = await onRequestGet({ env: { DB: db }, data: { user: USER } });
  const body = await res.json();
  assert.equal(body.tree_size_bytes, new TextEncoder().encode(treeJson).length);
  assert.ok(body.tree_size_bytes > treeJson.length, 'byte count should exceed JS string length for accented characters');
});

const RICH_PERSON = {
  id: 'p1', display_name: 'James Mercer', photo: '/api/photos/abc', gender: 'male',
  is_living: true, is_deceased: false, is_minor: false,
  birth_date: '1985-01-01', death_date: null, visibility: 'full',
  confidence: 'confirmed', claimed_by_user_id: null,
  // "extra" fields — everything below is NOT in the core allowlist.
  bio: 'A long biography paragraph. '.repeat(10),
  tags: ['veteran', 'engineer', 'father'],
  occupation: 'Railway signaller', residence: 'Melbourne, Australia',
  events: [{ year: '2001', title: 'Married' }],
  military_rank: 'Sergeant', military_branch: 'army',
};

await test('breakdown splits a person into core vs extra fields, and counts every field exactly once', async () => {
  const tree = {
    people: [RICH_PERSON],
    relationships: [{ from_person: 'p1', to_person: 'p2', type: 'partner' }],
    memories: [{ id: 'm1', text: 'hello' }],
    photos: [{ id: 'ph1', src: '/api/photos/x' }],
    documents: [],
    activity: [{ id: 'a1', type: 'person_added' }],
    _deleted: { memories: { m2: 123 } },
  };
  const treeRow = { tree_json: JSON.stringify(tree), updated_at: 1000 };
  const db = makeFakeDB({ userRow: USER_ROW, membershipRow: MEMBERSHIP, familyRow: FAMILY, treeRow });
  const res = await onRequestGet({ env: { DB: db }, data: { user: USER } });
  const body = await res.json();
  const b = body.breakdown;

  assert.equal(b.people.count, 1);
  assert.ok(b.people.coreBytes > 0 && b.people.extraBytes > 0);
  // The rich bio/tags/events content is deliberately the bulk of this
  // fixture — extra should dominate, proving the split actually discriminates
  // rather than just splitting everything evenly.
  assert.ok(b.people.extraBytes > b.people.coreBytes,
    `expected extra (${b.people.extraBytes}) > core (${b.people.coreBytes}) for a rich profile`);
  assert.equal(b.people.avgCoreBytesPerPerson, b.people.coreBytes);
  assert.equal(b.people.avgExtraBytesPerPerson, b.people.extraBytes);

  assert.equal(b.relationships.count, 1);
  assert.ok(b.relationships.totalBytes > 0);
  assert.equal(b.memories.count, 1);
  assert.equal(b.photos.count, 1);
  assert.equal(b.activity.count, 1);
  assert.ok(b.deletedBytes > 0);
});

await test('documents.thumbBytes isolates inline base64 thumbnails from everything else on the document', async () => {
  const inlineThumb = 'data:image/jpeg;base64,' + 'A'.repeat(2000); // a fat inline "thumbnail"
  const tree = {
    people: [],
    documents: [
      { id: 'd1', title: 'Discharge papers', src: '/api/documents/xyz', thumb: inlineThumb, extracted: { summary: 'x'.repeat(50) } },
      { id: 'd2', title: 'Letter', src: '/api/documents/abc', thumb: null, extracted: null },
    ],
  };
  const treeRow = { tree_json: JSON.stringify(tree), updated_at: 1000 };
  const db = makeFakeDB({ userRow: USER_ROW, membershipRow: MEMBERSHIP, familyRow: FAMILY, treeRow });
  const res = await onRequestGet({ env: { DB: db }, data: { user: USER } });
  const { documents } = (await res.json()).breakdown;

  assert.equal(documents.count, 2);
  assert.ok(documents.thumbBytes >= inlineThumb.length, 'the inline thumbnail should dominate documents.thumbBytes');
  assert.ok(documents.extractedBytes > 0);
  // The doc with no thumb/extracted must not contribute false bytes.
  assert.ok(documents.thumbBytes < documents.totalBytes);
});

await test('an unknown/future person field defaults to extra, never silently core', async () => {
  const tree = { people: [{ id: 'p1', display_name: 'X', some_new_field_from_the_future: 'y'.repeat(500) }] };
  const treeRow = { tree_json: JSON.stringify(tree), updated_at: 1000 };
  const db = makeFakeDB({ userRow: USER_ROW, membershipRow: MEMBERSHIP, familyRow: FAMILY, treeRow });
  const res = await onRequestGet({ env: { DB: db }, data: { user: USER } });
  const { people } = (await res.json()).breakdown;
  assert.ok(people.extraBytes > 400, 'an unrecognized field must fall through to extra, not core');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
