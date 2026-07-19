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
import {
  store, importFromGedcom, setRelationshipKind, addMedal, removeMedal,
  addLifeEvent, updatePerson, retractDocumentContributions,
  addRelative, updatePartnerMeta, resetTree, addMemory, addPhoto, addDocument,
} from '../src/data/store.js';

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

// ── retractDocumentContributions: the root-cause fix ───────────────────────
// (a document accepted onto the wrong person used to leave permanent,
// untraceable data behind — nothing recorded which document a fact came
// from. Now every additive write is tagged, so deleting the document can
// retract exactly what it produced.)
test('retractDocumentContributions removes only the events/medals tagged with that document', () => {
  importFromGedcom([{ id: 'ed', display_name: 'Edward Turner' }], [], { merge: false });
  addLifeEvent('ed', { year: 1943, title: 'Enlisted', sourceDocId: 'docA' });
  addLifeEvent('ed', { year: 1985, title: 'Married' }); // no source — manual entry
  addMedal('ed', { name: "Wrong Person's Medal", sourceDocId: 'docA' });
  addMedal('ed', { name: 'Own Medal', sourceDocId: 'docB' });

  retractDocumentContributions('ed', 'docA');

  const p = store.getState().people.find((x) => x.id === 'ed');
  assert.deepEqual(p.events.map((e) => e.title), ['Married']);
  assert.deepEqual(p.military_medals.map((m) => m.name), ['Own Medal']);
});

test('retractDocumentContributions clears a profile field only while still attributed to that document', () => {
  importFromGedcom([{ id: 'jt', display_name: 'James Turner' }], [], { merge: false });
  updatePerson('jt', { military_branch: 'army', field_sources: { military_branch: 'docA' } });

  retractDocumentContributions('jt', 'docA');

  const p = store.getState().people.find((x) => x.id === 'jt');
  assert.equal(p.military_branch, null);
  assert.equal(p.field_sources.military_branch, undefined);
});

test('retractDocumentContributions never clobbers a field a human corrected by hand afterward', () => {
  importFromGedcom([{ id: 'al', display_name: 'Allen' }], [], { merge: false });
  updatePerson('al', { military_rank: 'Private', field_sources: { military_rank: 'docA' } });
  // The human edit form (App.jsx's handleSave) clears field_sources for any
  // field it changes — simulated here directly, since that's App-layer glue,
  // not something store.js itself does.
  updatePerson('al', { military_rank: 'Corporal', field_sources: {} });

  retractDocumentContributions('al', 'docA');

  const p = store.getState().people.find((x) => x.id === 'al');
  assert.equal(p.military_rank, 'Corporal', 'a later hand-typed correction must survive the old document being deleted');
});

test('retractDocumentContributions is a harmless no-op when the document produced nothing tracked', () => {
  importFromGedcom([{ id: 'nn', display_name: 'No Notes' }], [], { merge: false });
  addLifeEvent('nn', { year: 2000, title: 'Something', sourceDocId: 'docX' });
  const before = store.getState();

  retractDocumentContributions('nn', 'docZ'); // a different, unrelated document id

  assert.equal(store.getState(), before, 'no matching contributions -> no commit at all');
});

// ── Marriage/separation captured at creation time ──────────────────────────
// (feedback: "there is a married component of the partner piece... but it's
// not obvious" — surfacing the same is_married/marriage_date/separation_date
// fields at the point a new partner/ex-partner is added, not just later via
// the buried per-relationship "manage" menu.)
test('addRelative for a new partner stamps is_married/marriage_date on the partner edge', () => {
  importFromGedcom([{ id: 'anchor', display_name: 'Anchor' }], [], { merge: false });

  addRelative({
    anchorId: 'anchor', relKey: 'partner', given: 'Robin', family: 'Doe',
    is_married: true, marriage_date: '2010-06-01',
  });

  const edge = store.getState().relationships.find((r) => r.type === 'partner');
  assert.equal(edge.partner_status, 'current');
  assert.equal(edge.is_married, true);
  assert.equal(edge.marriage_date, '2010-06-01');
});

test('addRelative for a new ex-partner stamps marriage AND separation on the edge', () => {
  importFromGedcom([{ id: 'anchor2', display_name: 'Anchor Two' }], [], { merge: false });

  addRelative({
    anchorId: 'anchor2', relKey: 'ex_partner', given: 'Sam', family: 'Doe',
    is_married: true, marriage_date: '1998-03-14', separation_date: '2005',
  });

  const edge = store.getState().relationships.find((r) => r.type === 'partner' && r.from_person === 'anchor2');
  assert.equal(edge.partner_status, 'former');
  assert.equal(edge.is_married, true);
  assert.equal(edge.marriage_date, '1998-03-14');
  assert.equal(edge.separation_date, '2005');
});

test('addRelative for a new ex-partner who was never married still records the separation date', () => {
  importFromGedcom([{ id: 'anchor3', display_name: 'Anchor Three' }], [], { merge: false });

  addRelative({
    anchorId: 'anchor3', relKey: 'ex_partner', given: 'Jo', family: 'Doe',
    is_married: false, separation_date: '2012',
  });

  const edge = store.getState().relationships.find((r) => r.type === 'partner' && r.from_person === 'anchor3');
  assert.equal(edge.is_married, undefined, 'no marriage evidence -> field left unset, not falsely true');
  assert.equal(edge.separation_date, '2012');
});

test('addRelative for a plain new partner (no marriage fields passed) leaves the edge unmarried', () => {
  importFromGedcom([{ id: 'anchor4', display_name: 'Anchor Four' }], [], { merge: false });

  addRelative({ anchorId: 'anchor4', relKey: 'partner', given: 'Lee', family: 'Doe' });

  const edge = store.getState().relationships.find((r) => r.type === 'partner');
  assert.equal(edge.is_married, undefined);
  assert.equal(edge.separation_date, undefined);
});

test('updatePartnerMeta persists a separation date independent of is_married', () => {
  seedPartners('former');
  const [a, b] = ['tina', 'randy'];

  updatePartnerMeta(a, b, { is_married: false, separation_date: '2018-09' });

  const edge = store.getState().relationships.find((r) => r.type === 'partner');
  assert.equal(edge.is_married, false);
  assert.equal(edge.separation_date, '2018-09');
});

test('updatePartnerMeta clears a separation date back to null when omitted', () => {
  seedPartners('former');
  const [a, b] = ['tina', 'randy'];
  updatePartnerMeta(a, b, { separation_date: '2018' });
  assert.equal(store.getState().relationships.find((r) => r.type === 'partner').separation_date, '2018');

  updatePartnerMeta(a, b, {}); // save with the field cleared in the editor

  assert.equal(store.getState().relationships.find((r) => r.type === 'partner').separation_date, null);
});

// Regression test for the "erase tree looks like it started over, but the
// tree comes back" bug: resetTree() used to just commit({ ...EMPTY }),
// clearing local state but never tombstoning anything — a later sync merge
// (a conflict retry, a background poll, the next login) would see "no local
// record for this id" and just keep whatever the server still had, silently
// undoing the erase. It now tombstones every person/relationship/memory/
// photo/document that existed, the same mechanism removePerson already
// uses for a single person.
test('resetTree tombstones every existing person/relationship/memory/photo/document', () => {
  importFromGedcom(
    [
      { id: 'nora', display_name: 'Nora Fitzgerald' },
      { id: 'evan', display_name: 'Evan Whitfield' },
    ],
    [{ id: 'r_reset', type: 'partner', from_person: 'nora', to_person: 'evan', partner_status: 'current' }],
    { merge: false },
  );
  const memId = addMemory('nora', { text: 'A memory worth keeping.' });
  const photoId = addPhoto('nora', { src: 'data:image/png;base64,abc', caption: 'A photo' });
  const docId = addDocument('nora', { title: 'A document', mime: 'application/pdf', src: 'data:application/pdf;base64,abc' });

  resetTree();

  const after = store.getState();
  assert.equal(after.people.length, 0, 'people should be cleared');
  assert.equal(after.relationships.length, 0, 'relationships should be cleared');
  assert.equal(after.memories.length, 0, 'memories should be cleared');
  assert.equal(after.photos.length, 0, 'photos should be cleared');
  assert.equal(after.documents.length, 0, 'documents should be cleared');
  assert.equal(after.hasCompletedOnboarding, false, 'onboarding should re-trigger');

  assert.ok(after._deleted?.people?.nora, 'nora must be tombstoned');
  assert.ok(after._deleted?.people?.evan, 'evan must be tombstoned');
  assert.ok(after._deleted?.relationships?.r_reset, 'the partner edge must be tombstoned');
  assert.ok(after._deleted?.memories?.[memId], 'the memory must be tombstoned');
  assert.ok(after._deleted?.photos?.[photoId], 'the photo must be tombstoned');
  assert.ok(after._deleted?.documents?.[docId], 'the document must be tombstoned');
});

test('resetTree tombstones survive a simulated server merge (the actual bug scenario)', () => {
  importFromGedcom(
    [{ id: 'iris', display_name: 'Iris Delacroix' }],
    [],
    { merge: false },
  );
  resetTree();
  const erased = store.getState();

  // Simulate what _fetchAndMerge does on a conflict/poll: union deletions,
  // drop anything tombstoned, union whatever the "server" still has. If the
  // erase's tombstones are missing, this resurrects iris; with them, she
  // must stay gone regardless of what the stale server copy still holds.
  const staleServerPeople = [{ id: 'iris', display_name: 'Iris Delacroix' }];
  const survivingPeople = staleServerPeople.filter((p) => !erased._deleted?.people?.[p.id]);
  assert.equal(survivingPeople.length, 0, 'a tombstoned person must not survive a merge with a stale server copy');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
