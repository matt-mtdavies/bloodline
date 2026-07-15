/**
 * Unit tests for splitTree/reassembleTree (functions/_lib/treeStore.js) —
 * the pure, I/O-free core/extra divider at the heart of docs/TREE-STORAGE.md
 * Phase 2. Every test here either proves the round-trip property
 * (reassembleTree(...splitTree(x)) deep-equals x) across a range of
 * realistic tree shapes, or proves the split boundary lands exactly where
 * §6.1/§6.2 specify. Nothing in this file touches D1 or R2 — that wiring
 * comes after these functions are trusted.
 * Run with: node tests/tree-split.test.mjs
 */
import assert from 'node:assert/strict';
import { splitTree, reassembleTree, CORE_PERSON_FIELDS } from '../functions/_lib/treeStore.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function roundTrip(tree) {
  const { core, extra } = splitTree(tree);
  return reassembleTree(core, extra);
}

// ── Fixtures ─────────────────────────────────────────────────────────────

// A rich, realistic tree — the shape a real, actively-used family produces.
const RICH_TREE = {
  people: [
    {
      id: 'p1', display_name: 'James Mercer', photo: '/api/photos/abc.jpg',
      gender: 'male', is_living: true, is_deceased: false, is_minor: false,
      birth_date: '1985-04-12', death_date: null, visibility: 'full',
      confidence: 'confirmed', claimed_by_user_id: 'u1',
      bio: 'A long biography paragraph about James.',
      tags: ['veteran', 'engineer'], occupation: 'Signaller', residence: 'Melbourne',
      events: [{ year: '2010', title: 'Married' }],
      military_rank: 'Sergeant', military_branch: 'army', military_nation: 'Australia',
      health_notes: 'No known conditions.',
    },
    {
      // A minimal person — no profile-detail fields at all.
      id: 'p2', display_name: 'Fiona Mercer', photo: null, gender: 'female',
      is_living: true, is_deceased: false, is_minor: false,
      birth_date: '1988-09-01', death_date: null, visibility: 'full',
      confidence: 'confirmed', claimed_by_user_id: null,
    },
    {
      // Someone deceased, with a death_date and cause_of_death (extra).
      id: 'p3', display_name: 'Percy Mercer', photo: '/api/photos/percy.jpg',
      gender: 'male', is_living: false, is_deceased: true, is_minor: false,
      birth_date: '1923-01-01', death_date: '1998-06-15', visibility: 'full',
      confidence: 'confirmed', claimed_by_user_id: null,
      cause_of_death: 'Natural causes', bio: 'Railwayman.',
    },
  ],
  relationships: [
    { id: 'r1', type: 'partner', from_person: 'p1', to_person: 'p2', partner_status: 'current', is_married: true, marriage_date: '2010-05-01', marriage_place: 'Melbourne' },
    { id: 'r2', type: 'parent', from_person: 'p3', to_person: 'p1', qualifier: 'biological' },
  ],
  memories: [{ id: 'm1', person_id: 'p1', text: 'A fond memory.', votes: 3 }],
  photos: [{ id: 'ph1', person_id: 'p1', src: '/api/photos/gallery1.jpg', caption: 'At the lake', date: '2015' }],
  documents: [{ id: 'd1', person_id: 'p3', title: 'Discharge Papers', mime: 'application/pdf', src: '/api/documents/xyz', thumb: '/api/documents/thumb1', extracted: { summary: 'Served 1943-1945.' } }],
  activity: [{ id: 'a1', type: 'person_added', personId: 'p1', personName: 'James Mercer', created_at: '2026-01-01T00:00:00Z' }],
  hasCompletedOnboarding: true,
  familyName: 'The Mercer Family',
  myPersonId: 'p1',
  _seq: 12,
  _deleted: {
    people: { p_old: 1700000000000 },
    relationships: { r_old: 1700000000001 },
    memories: { m_old: 1700000000002 },
    photos: { ph_old: 1700000000003 },
    documents: { d_old: 1700000000004 },
  },
};

// The exact shape src/data/store.js's EMPTY constant produces for a fresh,
// never-touched tree.
const EMPTY_TREE = {
  people: [], relationships: [], memories: [], photos: [], documents: [], activity: [],
  hasCompletedOnboarding: false, familyName: '', myPersonId: null,
  _deleted: {},
};

// A tree from before some fields existed — missing hasCompletedOnboarding,
// _seq, and per-person visibility/confidence entirely (not null — ABSENT).
const LEGACY_TREE = {
  people: [{ id: 'p1', display_name: 'Old Record', is_living: true, is_deceased: false }],
  relationships: [],
  memories: [], photos: [], documents: [], activity: [],
  familyName: 'Legacy Family',
  myPersonId: 'p1',
  // no hasCompletedOnboarding, no _seq, no _deleted at all
};

// ── Round-trip property across realistic shapes ─────────────────────────

test('a rich, realistic tree round-trips exactly through split + reassemble', () => {
  assert.deepEqual(roundTrip(RICH_TREE), RICH_TREE);
});

test('the fresh-tree EMPTY shape (including an explicit empty _deleted: {}) round-trips exactly', () => {
  assert.deepEqual(roundTrip(EMPTY_TREE), EMPTY_TREE);
});

test('a legacy tree missing hasCompletedOnboarding/_seq/_deleted entirely round-trips without inventing defaults', () => {
  const result = roundTrip(LEGACY_TREE);
  assert.deepEqual(result, LEGACY_TREE);
  assert.ok(!('hasCompletedOnboarding' in result), 'must not invent a value for a field that was never present');
  assert.ok(!('_seq' in result));
  assert.ok(!('_deleted' in result));
});

test('a person missing visibility/confidence entirely (pre-dating those fields) round-trips without inventing them', () => {
  const tree = { people: [{ id: 'p1', display_name: 'X', is_living: true }], relationships: [] };
  const result = roundTrip(tree);
  assert.deepEqual(result, tree);
  assert.ok(!('visibility' in result.people[0]));
});

test('an unrecognized/future person field is preserved through extra, not dropped and not promoted to core', () => {
  const tree = { people: [{ id: 'p1', display_name: 'X', is_living: true, some_field_from_the_future: 'value' }], relationships: [] };
  const { core } = splitTree(tree);
  assert.ok(!('some_field_from_the_future' in core.people[0]), 'unknown fields must not leak into core');
  assert.deepEqual(roundTrip(tree), tree, 'but must still round-trip faithfully via extra');
});

test('an unrecognized/future top-level key defaults to extra and still round-trips', () => {
  const tree = { people: [], relationships: [], some_future_top_level_thing: { x: 1 } };
  const { core, extra } = splitTree(tree);
  assert.ok(!('some_future_top_level_thing' in core));
  assert.deepEqual(extra.some_future_top_level_thing, { x: 1 });
  assert.deepEqual(roundTrip(tree), tree);
});

// ── The split boundary lands exactly where §6.1/§6.2 specify ──────────────

test('splitTree puts exactly the allowlisted fields on each core person, nothing more', () => {
  const { core } = splitTree(RICH_TREE);
  const jamesCoreKeys = Object.keys(core.people[0]).sort();
  const expected = [...CORE_PERSON_FIELDS].filter((f) => f in RICH_TREE.people[0]).sort();
  assert.deepEqual(jamesCoreKeys, expected);
  assert.ok(!('bio' in core.people[0]));
  assert.ok(!('tags' in core.people[0]));
  assert.ok(!('military_rank' in core.people[0]));
});

test('splitTree puts every non-core field into extra.peopleDetail, keyed by person id', () => {
  const { extra } = splitTree(RICH_TREE);
  assert.deepEqual(extra.peopleDetail.p1.bio, RICH_TREE.people[0].bio);
  assert.deepEqual(extra.peopleDetail.p1.tags, RICH_TREE.people[0].tags);
  assert.equal(extra.peopleDetail.p1.military_rank, 'Sergeant');
  assert.equal(extra.peopleDetail.p3.cause_of_death, 'Natural causes');
  // p2 has no extra fields at all — no entry should be created for it.
  assert.ok(!('p2' in extra.peopleDetail), 'a person with nothing beyond core fields gets no peopleDetail entry');
});

test('relationships stay whole in core, never touched by extra', () => {
  const { core, extra } = splitTree(RICH_TREE);
  assert.deepEqual(core.relationships, RICH_TREE.relationships);
  assert.ok(!('relationships' in extra));
});

test('memories/photos/documents/activity go to extra in full, untouched', () => {
  const { core, extra } = splitTree(RICH_TREE);
  assert.deepEqual(extra.memories, RICH_TREE.memories);
  assert.deepEqual(extra.photos, RICH_TREE.photos);
  assert.deepEqual(extra.documents, RICH_TREE.documents);
  assert.deepEqual(extra.activity, RICH_TREE.activity);
  assert.ok(!('memories' in core) && !('photos' in core) && !('documents' in core) && !('activity' in core));
});

test('_deleted splits by kind: people/relationships to core, memories/photos/documents to extra', () => {
  const { core, extra } = splitTree(RICH_TREE);
  assert.deepEqual(core._deleted, { people: RICH_TREE._deleted.people, relationships: RICH_TREE._deleted.relationships });
  assert.deepEqual(extra._deleted, { memories: RICH_TREE._deleted.memories, photos: RICH_TREE._deleted.photos, documents: RICH_TREE._deleted.documents });
});

test('scalars (myPersonId, familyName, hasCompletedOnboarding, _seq) land in core only', () => {
  const { core, extra } = splitTree(RICH_TREE);
  assert.equal(core.myPersonId, 'p1');
  assert.equal(core.familyName, 'The Mercer Family');
  assert.equal(core.hasCompletedOnboarding, true);
  assert.equal(core._seq, 12);
  for (const k of ['myPersonId', 'familyName', 'hasCompletedOnboarding', '_seq']) {
    assert.ok(!(k in extra), `${k} must not appear in extra`);
  }
});

// ── Graceful degradation when extra is missing (unmigrated family / R2 miss) ─

test('reassembleTree with extra=null degrades every extra-owned collection to absent, never throws', () => {
  const { core } = splitTree(RICH_TREE);
  const result = reassembleTree(core, null);
  assert.ok(!('memories' in result) && !('photos' in result) && !('documents' in result) && !('activity' in result));
  // Core-owned data (people's core fields, relationships) is still there.
  assert.equal(result.people.length, 3);
  assert.equal(result.people[0].display_name, 'James Mercer');
  // But the rich profile detail (which lived only in extra) is gone.
  assert.ok(!('bio' in result.people[0]));
  assert.deepEqual(result.relationships, RICH_TREE.relationships);
  // _deleted still reflects core's half even with no extra.
  assert.deepEqual(result._deleted, { people: RICH_TREE._deleted.people, relationships: RICH_TREE._deleted.relationships });
});

test('reassembleTree with extra=undefined behaves identically to extra=null', () => {
  const { core } = splitTree(EMPTY_TREE);
  assert.deepEqual(reassembleTree(core, undefined), reassembleTree(core, null));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
