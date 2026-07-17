/**
 * Regression test for the "ex-partner reverts back to partner a few seconds
 * later" bug: setRelationshipKind() replaced the old edge with a new one
 * locally but never tombstoned the old edge's id, so a sync merge that saw
 * the old edge still on the server (background poll, or a 409-conflict
 * retry) would resurrect it via id union, and the dedup step in commit()
 * then kept that resurrected "current" edge over the new "former" one —
 * silently reverting the user's edit.
 * Run with: node tests/store.test.mjs
 */
import assert from 'node:assert/strict';
import { store, importFromGedcom, setRelationshipKind, addMedal, removeMedal } from '../src/data/store.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

function seedPartners(status = 'current') {
  importFromGedcom(
    [
      { id: 'tina', display_name: 'Tina Reynolds' },
      { id: 'randy', display_name: 'Randy Dyer' },
    ],
    [{ id: 'r1', type: 'partner', from_person: 'tina', to_person: 'randy', partner_status: status }],
    { merge: false },
  );
}

test('partner -> ex_partner tombstones the replaced "current" edge id', () => {
  seedPartners('current');
  const oldEdgeId = store.getState().relationships.find((r) => r.type === 'partner').id;

  const res = setRelationshipKind('tina', 'randy', 'ex_partner');
  assert.equal(res.ok, true);

  const after = store.getState();
  const partnerEdges = after.relationships.filter((r) => r.type === 'partner');
  assert.equal(partnerEdges.length, 1, 'exactly one partner edge should remain');
  assert.equal(partnerEdges[0].partner_status, 'former');
  assert.notEqual(partnerEdges[0].id, oldEdgeId, 'the new edge must be a distinct id, not a mutation');
  assert.ok(
    after._deleted?.relationships?.[oldEdgeId],
    'the replaced "current" edge id must be tombstoned so a sync merge can\'t resurrect it',
  );
});

test('ex_partner -> partner tombstones the replaced "former" edge id (the reverse edit)', () => {
  seedPartners('former');
  const oldEdgeId = store.getState().relationships.find((r) => r.type === 'partner').id;

  const res = setRelationshipKind('tina', 'randy', 'partner');
  assert.equal(res.ok, true);

  const after = store.getState();
  const partnerEdges = after.relationships.filter((r) => r.type === 'partner');
  assert.equal(partnerEdges.length, 1);
  assert.equal(partnerEdges[0].partner_status, 'current');
  assert.ok(after._deleted?.relationships?.[oldEdgeId], 'the replaced "former" edge id must be tombstoned');
});

test('setRelationshipKind on a brand-new pair (no prior edge) tombstones nothing', () => {
  importFromGedcom(
    [
      { id: 'a', display_name: 'A' },
      { id: 'b', display_name: 'B' },
    ],
    [],
    { merge: false },
  );
  const before = store.getState()._deleted?.relationships || {};
  const beforeCount = Object.keys(before).length;

  setRelationshipKind('a', 'b', 'partner');

  const after = store.getState();
  assert.equal(Object.keys(after._deleted?.relationships || {}).length, beforeCount);
  assert.equal(after.relationships.filter((r) => r.type === 'partner').length, 1);
});

// ── Medals: the one manual undo for a wrongly-accepted document medal ──────
// (see the Edward Turner report: a document accepted onto the wrong
// person's profile leaves no live link back to itself, so removing a
// mis-attributed medal is a plain, permanent, index-based edit.)
test('removeMedal deletes exactly the targeted medal, leaving the rest untouched', () => {
  importFromGedcom([{ id: 'ed', display_name: 'Edward Turner' }], [], { merge: false });
  addMedal('ed', { name: 'Military Medal' });
  addMedal('ed', { name: "His Brother's Medal", detail: 'wrongly attributed' });
  addMedal('ed', { name: 'Long Service Medal' });
  assert.equal(store.getState().people.find((p) => p.id === 'ed').military_medals.length, 3);

  removeMedal('ed', 1);

  const medals = store.getState().people.find((p) => p.id === 'ed').military_medals;
  assert.equal(medals.length, 2);
  assert.deepEqual(medals.map((m) => m.name), ['Military Medal', 'Long Service Medal']);
});

test('removeMedal on an out-of-range index is a harmless no-op', () => {
  importFromGedcom([{ id: 'sam', display_name: 'Sam' }], [], { merge: false });
  addMedal('sam', { name: 'Star' });

  removeMedal('sam', 5);

  assert.equal(store.getState().people.find((p) => p.id === 'sam').military_medals.length, 1);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
