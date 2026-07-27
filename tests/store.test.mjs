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
  bioParentGendersFilled, addResidence, updateResidence, removeResidence,
  backfillResidenceGeocodes, setRestingPlace, clearRestingPlace,
} from '../src/data/store.js';
import { buildGraph } from '../src/data/graph.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}
async function atest(label, fn) {
  try { await fn(); passed++; console.log(`PASS  ${label}`); }
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

// ── addRelative: resting place captured at creation time ────────────────
// Real user feedback: resting place should be fillable on the initial
// "add relative" screen (right where birthplace/lives in/deceased already
// are), not require a separate trip into the profile editor afterward.

test('addRelative: a deceased new relative with a resting place gets a bare { place } record', () => {
  importFromGedcom([{ id: 'anchor5', display_name: 'Anchor Five' }], [], { merge: false });

  const newId = addRelative({
    anchorId: 'anchor5', relKey: 'brother', given: 'Tom', family: 'Doe',
    is_deceased: true, death_date: '1990', resting_place: 'Highgate Cemetery, London',
  });

  const person = store.getState().people.find((p) => p.id === newId);
  assert.deepEqual(person.resting_place, { place: 'Highgate Cemetery, London' });
});

test('addRelative: resting place is ignored when the person is not marked deceased', () => {
  importFromGedcom([{ id: 'anchor6', display_name: 'Anchor Six' }], [], { merge: false });

  const newId = addRelative({
    anchorId: 'anchor6', relKey: 'brother', given: 'Sam', family: 'Doe',
    is_deceased: false, resting_place: 'Some Cemetery',
  });

  const person = store.getState().people.find((p) => p.id === newId);
  assert.equal(person.resting_place, null, 'a living person can\'t have a resting place, regardless of what the field held');
});

test('addRelative: a deceased new relative with no resting place typed leaves it null (not an empty-string record)', () => {
  importFromGedcom([{ id: 'anchor7', display_name: 'Anchor Seven' }], [], { merge: false });

  const newId = addRelative({
    anchorId: 'anchor7', relKey: 'brother', given: 'Joe', family: 'Doe',
    is_deceased: true, death_date: '1990',
  });

  const person = store.getState().people.find((p) => p.id === newId);
  assert.equal(person.resting_place, null);
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

// Regression test for the sibling bug found while reviewing the import
// pipeline (real report: a 600-person import "cited many duplicates
// created"): importFromGedcom's merge:false ("Replace") branch had the
// exact same un-tombstoned-wipe pattern resetTree() had — it swapped in
// {...EMPTY, people: newPeople, ...} with no record that the OLD tree was
// deliberately erased, so a later sync merge could silently resurrect it
// underneath the freshly-imported data.
test('importFromGedcom (replace mode) tombstones the old tree before swapping in the import', () => {
  importFromGedcom(
    [
      { id: 'old_a', display_name: 'Old Person A' },
      { id: 'old_b', display_name: 'Old Person B' },
    ],
    [{ id: 'r_old', type: 'partner', from_person: 'old_a', to_person: 'old_b', partner_status: 'current' }],
    { merge: false },
  );
  const memId = addMemory('old_a', { text: 'An old memory.' });
  const photoId = addPhoto('old_a', { src: 'data:image/png;base64,abc', caption: 'An old photo' });
  const docId = addDocument('old_a', { title: 'An old document', mime: 'application/pdf', src: 'data:application/pdf;base64,abc' });

  importFromGedcom(
    [{ id: 'new_a', display_name: 'New Person A' }],
    [],
    { merge: false },
  );

  const after = store.getState();
  assert.deepEqual(after.people.map((p) => p.id), ['new_a'], 'only the newly imported person should remain');
  assert.equal(after.relationships.length, 0, 'the old relationship should be gone');

  assert.ok(after._deleted?.people?.old_a, 'old_a must be tombstoned');
  assert.ok(after._deleted?.people?.old_b, 'old_b must be tombstoned');
  assert.ok(after._deleted?.relationships?.r_old, 'the old partner edge must be tombstoned');
  assert.ok(after._deleted?.memories?.[memId], 'the old memory must be tombstoned');
  assert.ok(after._deleted?.photos?.[photoId], 'the old photo must be tombstoned');
  assert.ok(after._deleted?.documents?.[docId], 'the old document must be tombstoned');

  // Same merge-survival check as resetTree's own regression test — a stale
  // server copy of the old tree must not resurrect through the tombstones.
  const staleServerPeople = [{ id: 'old_a', display_name: 'Old Person A' }];
  const survivingPeople = staleServerPeople.filter((p) => !after._deleted?.people?.[p.id]);
  assert.equal(survivingPeople.length, 0, 'a tombstoned old person must not survive a merge with a stale server copy');
});

test('bioParentGendersFilled recognizes a Title Case gender (as EditPersonSheet used to store) as filling the same slot as lowercase — the bio-parent-per-gender constraint must not be bypassable by casing', () => {
  // The existing bio-father's gender is stored 'Male' (Title Case) — the
  // shape EditPersonSheet's gender picker used to write before the casing
  // fix, still present on any record edited before then. Without
  // normalizing, bioParentGendersFilled's Set would contain 'Male' while
  // the constraint check below always tests for lowercase 'male', so it
  // would silently miss this slot as already filled.
  importFromGedcom(
    [
      { id: 'child1', display_name: 'Child One' },
      { id: 'dad1', display_name: 'Dad One', gender: 'Male' },
    ],
    [{ id: 'r1', type: 'parent', from_person: 'dad1', to_person: 'child1', qualifier: 'biological' }],
    { merge: false },
  );

  const filled = bioParentGendersFilled('child1');
  assert.ok(filled.has('male'), 'a Title Case existing bio-father must still register as the male slot filled');

  // A second biological father must still be rejected.
  const res = addRelative({ anchorId: 'child1', relKey: 'father', name: 'Dad Two', qualifier: 'biological' });
  assert.equal(res, null, 'adding a second biological father must be blocked regardless of the existing father\'s gender casing');
  assert.equal(store.getState().people.length, 2, 'no new person should have been added');
});

// ── Places Lived: addResidence/updateResidence/removeResidence ─────────────

test('addResidence: appends a residence with a real id, works even on a person with no residences field at all', () => {
  importFromGedcom([{ id: 'nomad1', display_name: 'Nomad One' }], [], { merge: false });
  // A freshly-imported person has no `residences` field at all (it's only
  // ever backfilled by the one-time module-load migration) — addResidence
  // must handle that the same way it handles a genuinely empty array,
  // exactly the defence the migration exists to make redundant, not rely on.
  const person = store.getState().people.find((p) => p.id === 'nomad1');
  assert.equal(person.residences, undefined);

  const id = addResidence('nomad1', { place: 'Fremantle, Western Australia', from_year: 1990, to_year: 2001 });
  assert.ok(id, 'must return the new residence\'s id');
  const after = store.getState().people.find((p) => p.id === 'nomad1');
  assert.equal(after.residences.length, 1);
  assert.equal(after.residences[0].id, id);
  assert.equal(after.residences[0].place, 'Fremantle, Western Australia');
  assert.equal(after.residences[0].from_year, 1990);
  assert.equal(after.residences[0].to_year, 2001);
  assert.equal(after.residences[0].lat, null, 'lat/lon default to null — geocoding is optional and asynchronous');
});

test('addResidence: a second residence with no to_year records an ongoing/current stay', () => {
  importFromGedcom([{ id: 'nomad2', display_name: 'Nomad Two' }], [], { merge: false });
  addResidence('nomad2', { place: 'Fremantle, Western Australia', from_year: 1990, to_year: 2001 });
  addResidence('nomad2', { place: 'Cardiff, Wales', from_year: 2001 });
  const after = store.getState().people.find((p) => p.id === 'nomad2');
  assert.equal(after.residences.length, 2);
  assert.equal(after.residences[1].to_year, null);
});

// ── addRelative: sibling-add "only one parent recorded" ambiguity ──────────
// Real user report: choosing "Add Brother" implies a full sibling to most
// people, but silently linking the new sibling to only the anchor's single
// recorded parent made them read as a half-sibling with no indication that
// had happened. AddRelativeSheet.jsx now resolves this up front and passes
// back exactly what to do — these tests exercise addRelative()'s own side
// of that contract directly, independent of the UI.

function seedAnchorWithOneParent(extra = {}) {
  importFromGedcom(
    [
      { id: 'anchor', display_name: 'Anchor Person', gender: 'female' },
      { id: 'dad', display_name: 'Dad Person', gender: 'male' },
      ...(extra.partner ? [{ id: 'partner', display_name: 'Partner Person', gender: extra.partnerGender || 'female' }] : []),
    ],
    [
      { id: 'r1', type: 'parent', from_person: 'dad', to_person: 'anchor', qualifier: 'biological' },
      ...(extra.partner ? [{ id: 'r2', type: 'partner', from_person: 'dad', to_person: 'partner', partner_status: 'current' }] : []),
    ],
    { merge: false },
  );
}

test('sibling add, mode "existing": links the sole parent\'s partner as parent of BOTH the new sibling and the anchor (full sibling)', () => {
  seedAnchorWithOneParent({ partner: true });
  const newId = addRelative({
    anchorId: 'anchor', relKey: 'brother', given: 'Sib', family: 'Person',
    siblingOtherParentMode: 'existing', siblingOtherParentId: 'partner',
  });
  assert.ok(newId);
  const rels = store.getState().relationships;
  assert.ok(rels.some((r) => r.type === 'parent' && r.from_person === 'partner' && r.to_person === newId), 'partner is a parent of the new sibling');
  assert.ok(rels.some((r) => r.type === 'parent' && r.from_person === 'partner' && r.to_person === 'anchor'), 'partner is retroactively a parent of the anchor too');

  const g = buildGraph(store.getState().people, rels);
  const sib = g.siblings('anchor').find((s) => s.id === newId);
  assert.equal(sib.kind, 'full', 'anchor and the new sibling now share 2 bio parents — full siblings');
});

test('sibling add, mode "new": a different named parent is linked ONLY to the new sibling — a real, deliberate half-sibling', () => {
  seedAnchorWithOneParent({ partner: true });
  const newId = addRelative({
    anchorId: 'anchor', relKey: 'brother', given: 'Sib', family: 'Person',
    siblingOtherParentMode: 'new', siblingOtherParentNew: { given: 'Someone', family: 'Else' },
  });
  assert.ok(newId);
  const rels = store.getState().relationships;
  const anchorParentIds = rels.filter((r) => r.type === 'parent' && r.to_person === 'anchor').map((r) => r.from_person);
  assert.deepEqual(anchorParentIds, ['dad'], 'the anchor\'s own parents are untouched');
  const newPersonName = store.getState().people.find((p) => p.display_name === 'Someone Else');
  assert.ok(newPersonName, 'a brand-new distinct person was created for "a different parent"');
  assert.ok(rels.some((r) => r.type === 'parent' && r.from_person === newPersonName.id && r.to_person === newId));
  // father's existing partner was never touched
  assert.ok(!rels.some((r) => r.type === 'parent' && r.from_person === 'partner'));

  const g = buildGraph(store.getState().people, rels);
  const sib = g.siblings('anchor').find((s) => s.id === newId);
  assert.equal(sib.kind, 'half', 'they share exactly one bio parent (dad) — genuinely half-siblings, deliberately');
});

test('sibling add, mode "unknown": an unnamed placeholder parent is created and linked to BOTH people (full sibling, no name invented)', () => {
  seedAnchorWithOneParent({}); // no partner on record at all
  const newId = addRelative({
    anchorId: 'anchor', relKey: 'brother', given: 'Sib', family: 'Person',
    siblingOtherParentMode: 'unknown',
  });
  assert.ok(newId);
  const people = store.getState().people;
  const rels = store.getState().relationships;
  const placeholder = people.find((p) => p.confidence === 'uncertain' && p.gender === 'female');
  assert.ok(placeholder, 'an unnamed "Unknown Mother" placeholder was created (dad is male, so the missing role is female)');
  assert.ok(rels.some((r) => r.type === 'parent' && r.from_person === placeholder.id && r.to_person === 'anchor'));
  assert.ok(rels.some((r) => r.type === 'parent' && r.from_person === placeholder.id && r.to_person === newId));

  const g = buildGraph(people, rels);
  const sib = g.siblings('anchor').find((s) => s.id === newId);
  assert.equal(sib.kind, 'full', 'both now share dad + the placeholder — full siblings');
});

test('sibling add, mode "none": today\'s exact behaviour — only the one recorded parent is shared (half), no placeholder invented', () => {
  seedAnchorWithOneParent({ partner: true });
  const newId = addRelative({
    anchorId: 'anchor', relKey: 'brother', given: 'Sib', family: 'Person',
    siblingOtherParentMode: 'none',
  });
  const peopleBefore = store.getState().people.length;
  const rels = store.getState().relationships;
  assert.equal(rels.filter((r) => r.type === 'parent' && r.to_person === newId).length, 1, 'only dad is linked');
  assert.equal(store.getState().people.length, peopleBefore, 'no placeholder person created');

  const g = buildGraph(store.getState().people, rels);
  const sib = g.siblings('anchor').find((s) => s.id === newId);
  assert.equal(sib.kind, 'half');
});

test('sibling add with no siblingOtherParentMode at all (older/other callers): unchanged from before this feature — single shared parent, no prompt logic engaged', () => {
  seedAnchorWithOneParent({ partner: true });
  const peopleBefore = store.getState().people.length;
  const newId = addRelative({ anchorId: 'anchor', relKey: 'brother', given: 'Sib', family: 'Person' });
  assert.ok(newId);
  assert.equal(store.getState().people.length, peopleBefore + 1, 'exactly one new person, no placeholder');
  const rels = store.getState().relationships;
  assert.equal(rels.filter((r) => r.type === 'parent' && r.to_person === newId).length, 1);
});

test('sibling add, mode "existing": a same-gender candidate is linked to the new sibling but the anchor backfill is skipped rather than violating the one-bio-parent-per-gender rule', () => {
  seedAnchorWithOneParent({ partner: true, partnerGender: 'male' }); // two dads on record between them
  const newId = addRelative({
    anchorId: 'anchor', relKey: 'brother', given: 'Sib', family: 'Person',
    siblingOtherParentMode: 'existing', siblingOtherParentId: 'partner',
  });
  assert.ok(newId);
  const rels = store.getState().relationships;
  assert.ok(rels.some((r) => r.type === 'parent' && r.from_person === 'partner' && r.to_person === newId), 'still linked to the new sibling');
  assert.ok(!rels.some((r) => r.type === 'parent' && r.from_person === 'partner' && r.to_person === 'anchor'), 'anchor already has a male bio parent (dad) — backfill silently skipped, not blocked or crashed');
});

test('sibling add with 0 existing parents is untouched by this feature — still auto-creates BOTH placeholders (regression guard)', () => {
  importFromGedcom([{ id: 'loner', display_name: 'Loner Person' }], [], { merge: false });
  const newId = addRelative({ anchorId: 'loner', relKey: 'sister', given: 'Sib', family: 'Person' });
  assert.ok(newId);
  const rels = store.getState().relationships;
  const anchorParents = rels.filter((r) => r.type === 'parent' && r.to_person === 'loner');
  const sibParents = rels.filter((r) => r.type === 'parent' && r.to_person === newId);
  assert.equal(anchorParents.length, 2);
  assert.equal(sibParents.length, 2);
  const g = buildGraph(store.getState().people, rels);
  const sib = g.siblings('loner').find((s) => s.id === newId);
  assert.equal(sib.kind, 'full');
});

test('sibling add with 2 existing parents is untouched by this feature — both are reused, full sibling, no mode needed', () => {
  importFromGedcom(
    [
      { id: 'both1', display_name: 'Both One' },
      { id: 'mum2', display_name: 'Mum Two', gender: 'female' },
      { id: 'dad2', display_name: 'Dad Two', gender: 'male' },
    ],
    [
      { id: 'r1', type: 'parent', from_person: 'mum2', to_person: 'both1', qualifier: 'biological' },
      { id: 'r2', type: 'parent', from_person: 'dad2', to_person: 'both1', qualifier: 'biological' },
    ],
    { merge: false },
  );
  const newId = addRelative({ anchorId: 'both1', relKey: 'brother', given: 'Sib', family: 'Person' });
  const rels = store.getState().relationships;
  assert.equal(rels.filter((r) => r.type === 'parent' && r.to_person === newId).length, 2);
  const g = buildGraph(store.getState().people, rels);
  const sib = g.siblings('both1').find((s) => s.id === newId);
  assert.equal(sib.kind, 'full');
});

test('updateResidence: patches only the matching residence by id, leaves the other untouched', () => {
  importFromGedcom([{ id: 'nomad3', display_name: 'Nomad Three' }], [], { merge: false });
  const id1 = addResidence('nomad3', { place: 'Fremantle, Western Australia', from_year: 1990, to_year: 2001 });
  addResidence('nomad3', { place: 'Cardiff, Wales', from_year: 2001 });

  updateResidence('nomad3', id1, { to_year: 2000, lat: -32.05, lon: 115.75 });
  const after = store.getState().people.find((p) => p.id === 'nomad3');
  assert.equal(after.residences[0].to_year, 2000);
  assert.equal(after.residences[0].lat, -32.05);
  assert.equal(after.residences[1].place, 'Cardiff, Wales', 'the other residence must be untouched');
  assert.equal(after.residences[1].lat, null);
});

test('addResidence: stores the geocoded suburb/state/country breakdown alongside lat/lon, defaulting to null', () => {
  importFromGedcom([{ id: 'nomad5', display_name: 'Nomad Five' }], [], { merge: false });
  const id = addResidence('nomad5', {
    place: 'Fountain Gate, Victoria', from_year: 1980, to_year: 1988,
    lat: -38.0, lon: 145.3, suburb: 'Fountain Gate', state: 'Victoria', country: 'Australia',
  });
  const after = store.getState().people.find((p) => p.id === 'nomad5');
  const r = after.residences.find((x) => x.id === id);
  assert.equal(r.suburb, 'Fountain Gate');
  assert.equal(r.state, 'Victoria');
  assert.equal(r.country, 'Australia');

  const id2 = addResidence('nomad5', { place: 'Nowhereville', from_year: 1988 });
  const r2 = after && store.getState().people.find((p) => p.id === 'nomad5').residences.find((x) => x.id === id2);
  assert.equal(r2.suburb, null, 'suburb/state/country default to null when geocoding was never provided');
  assert.equal(r2.state, null);
  assert.equal(r2.country, null);
});

test('removeResidence: removes exactly the matching residence by id, keeps the rest in place', () => {
  importFromGedcom([{ id: 'nomad4', display_name: 'Nomad Four' }], [], { merge: false });
  const id1 = addResidence('nomad4', { place: 'Fremantle, Western Australia', from_year: 1990, to_year: 2001 });
  const id2 = addResidence('nomad4', { place: 'Cardiff, Wales', from_year: 2001 });

  removeResidence('nomad4', id1);
  const after = store.getState().people.find((p) => p.id === 'nomad4');
  assert.equal(after.residences.length, 1);
  assert.equal(after.residences[0].id, id2);
  assert.equal(after.residences[0].place, 'Cardiff, Wales');
});

// ── Places Lived: activity log gets a distinct type + the place name per action ──

test('addResidence logs a "residence_added" activity event naming the place', () => {
  importFromGedcom([{ id: 'nomad6', display_name: 'Nomad Six' }], [], { merge: false });
  addResidence('nomad6', { place: 'Bristol, England', from_year: 2003 });
  const [event] = store.getState().activity;
  assert.equal(event.type, 'residence_added');
  assert.equal(event.personId, 'nomad6');
  assert.equal(event.detail, 'Bristol, England');
});

test('removeResidence logs a "residence_removed" activity event naming the place that was removed', () => {
  importFromGedcom([{ id: 'nomad7', display_name: 'Nomad Seven' }], [], { merge: false });
  const id = addResidence('nomad7', { place: 'Perth, Australia', from_year: 2010 });
  removeResidence('nomad7', id);
  const [event] = store.getState().activity;
  assert.equal(event.type, 'residence_removed');
  assert.equal(event.detail, 'Perth, Australia', 'must name the place that was removed, even though it no longer exists on the person');
});

test('updateResidence logs a "residence_updated" activity event naming the (possibly just-edited) place', () => {
  importFromGedcom([{ id: 'nomad8', display_name: 'Nomad Eight' }], [], { merge: false });
  const id = addResidence('nomad8', { place: 'Cardiff, Wales', from_year: 1990, to_year: 2000 });
  updateResidence('nomad8', id, { to_year: 1998 });
  const notRenamed = store.getState().activity[0];
  assert.equal(notRenamed.type, 'residence_updated');
  assert.equal(notRenamed.detail, 'Cardiff, Wales', 'a year-only edit still names the existing place');

  updateResidence('nomad8', id, { place: 'Swansea, Wales' });
  const renamed = store.getState().activity[0];
  assert.equal(renamed.detail, 'Swansea, Wales', 'a place edit names the NEW place, not the old one');
});

// ── backfillResidenceGeocodes ────────────────────────────────────────────────

await atest('backfillResidenceGeocodes: no-op when nothing is missing coordinates', async () => {
  importFromGedcom([{ id: 'geo1', display_name: 'Geo One' }], [], { merge: false });
  addResidence('geo1', { place: 'Cardiff, Wales', from_year: 1990, lat: 51.48, lon: -3.18 });
  let called = false;
  const result = await backfillResidenceGeocodes(async () => { called = true; return {}; });
  assert.deepEqual(result, { total: 0, updated: 0, failed: 0 });
  assert.equal(called, false, 'must not even call the geocoder when nothing needs it');
});

await atest('backfillResidenceGeocodes: resolves residences missing lat/lon and leaves already-geocoded ones untouched', async () => {
  importFromGedcom([{ id: 'geo2', display_name: 'Geo Two' }], [], { merge: false });
  const alreadyGeocoded = addResidence('geo2', { place: 'Perth, Australia', from_year: 1980, lat: -31.95, lon: 115.86 });
  const missing1 = addResidence('geo2', { place: 'Cardiff, Wales', from_year: 1990 });
  const missing2 = addResidence('geo2', { place: 'Toronto, Canada', from_year: 2000 });

  const requested = [];
  const fakeGeocode = async (places) => {
    requested.push(...places);
    return {
      'Cardiff, Wales': { lat: 51.48, lon: -3.18, suburb: null, state: 'Wales', country: 'United Kingdom' },
      'Toronto, Canada': { lat: 43.65, lon: -79.38, suburb: null, state: 'Ontario', country: 'Canada' },
    };
  };
  const result = await backfillResidenceGeocodes(fakeGeocode);
  assert.deepEqual(result, { total: 2, updated: 2, failed: 0 });
  assert.deepEqual(requested.sort(), ['Cardiff, Wales', 'Toronto, Canada'], 'only the un-geocoded places are ever sent to the geocoder');

  const after = store.getState().people.find((p) => p.id === 'geo2');
  const perth = after.residences.find((r) => r.id === alreadyGeocoded);
  assert.equal(perth.lat, -31.95, 'an already-geocoded residence is left exactly as it was');
  const cardiff = after.residences.find((r) => r.id === missing1);
  assert.equal(cardiff.lat, 51.48);
  assert.equal(cardiff.state, 'Wales');
  assert.equal(cardiff.country, 'United Kingdom');
  const toronto = after.residences.find((r) => r.id === missing2);
  assert.equal(toronto.lat, 43.65);
});

await atest('backfillResidenceGeocodes: a place the geocoder can\'t resolve is left as-is and counted as failed', async () => {
  importFromGedcom([{ id: 'geo3', display_name: 'Geo Three' }], [], { merge: false });
  addResidence('geo3', { place: 'Nowhereville', from_year: 1990 });
  const result = await backfillResidenceGeocodes(async () => ({ Nowhereville: null }));
  assert.deepEqual(result, { total: 1, updated: 0, failed: 1 });
  const after = store.getState().people.find((p) => p.id === 'geo3');
  assert.equal(after.residences[0].lat, null);
});

await atest('backfillResidenceGeocodes: applies across multiple people in one pass, no activity logged (a silent backfill)', async () => {
  importFromGedcom([{ id: 'geo4a', display_name: 'Geo Four A' }, { id: 'geo4b', display_name: 'Geo Four B' }], [], { merge: false });
  addResidence('geo4a', { place: 'Cardiff, Wales', from_year: 1990 });
  addResidence('geo4b', { place: 'Cardiff, Wales', from_year: 1995 }); // same place, different person
  const activityBefore = store.getState().activity.length;

  const result = await backfillResidenceGeocodes(async () => ({
    'Cardiff, Wales': { lat: 51.48, lon: -3.18, suburb: null, state: 'Wales', country: 'United Kingdom' },
  }));
  assert.deepEqual(result, { total: 2, updated: 2, failed: 0 });
  assert.equal(store.getState().people.find((p) => p.id === 'geo4a').residences[0].lat, 51.48);
  assert.equal(store.getState().people.find((p) => p.id === 'geo4b').residences[0].lat, 51.48);
  assert.equal(store.getState().activity.length, activityBefore, 'a passive backfill must not log an activity event');
});

await atest('backfillResidenceGeocodes: a geocoder rejection is caught, leaving everything unchanged rather than throwing', async () => {
  importFromGedcom([{ id: 'geo5', display_name: 'Geo Five' }], [], { merge: false });
  addResidence('geo5', { place: 'Cardiff, Wales', from_year: 1990 });
  const result = await backfillResidenceGeocodes(async () => { throw new Error('network error'); });
  assert.deepEqual(result, { total: 1, updated: 0, failed: 1 });
});

// ── Resting place ────────────────────────────────────────────────────────

test('setRestingPlace: stores a single resting_place record with all fields, defaulting geocoded fields to null', () => {
  importFromGedcom([{ id: 'rest1', display_name: 'Rest One' }], [], { merge: false });
  setRestingPlace('rest1', { cemetery: 'Oak Hill Cemetery', plot: 'Section 4, Row B', place: 'Springfield, Illinois' });
  const person = store.getState().people.find((p) => p.id === 'rest1');
  assert.equal(person.resting_place.cemetery, 'Oak Hill Cemetery');
  assert.equal(person.resting_place.plot, 'Section 4, Row B');
  assert.equal(person.resting_place.place, 'Springfield, Illinois');
  assert.equal(person.resting_place.lat, null, 'lat/lon default to null — geocoding is optional and asynchronous');
  assert.equal(person.resting_place.suburb, null);
});

test('setRestingPlace: stores the geocoded suburb/state/country breakdown alongside lat/lon', () => {
  importFromGedcom([{ id: 'rest2', display_name: 'Rest Two' }], [], { merge: false });
  setRestingPlace('rest2', {
    cemetery: 'Père Lachaise', place: 'Paris, France',
    suburb: 'Paris', state: 'Île-de-France', country: 'France', lat: 48.86, lon: 2.39,
  });
  const person = store.getState().people.find((p) => p.id === 'rest2');
  assert.equal(person.resting_place.suburb, 'Paris');
  assert.equal(person.resting_place.state, 'Île-de-France');
  assert.equal(person.resting_place.country, 'France');
  assert.equal(person.resting_place.lat, 48.86);
});

test('setRestingPlace: calling it again replaces the whole record rather than merging with the old one', () => {
  importFromGedcom([{ id: 'rest3', display_name: 'Rest Three' }], [], { merge: false });
  setRestingPlace('rest3', { cemetery: 'First Cemetery', plot: 'Plot A', place: 'Town One' });
  setRestingPlace('rest3', { place: 'Town Two' }); // an edit that drops the cemetery/plot fields
  const person = store.getState().people.find((p) => p.id === 'rest3');
  assert.equal(person.resting_place.place, 'Town Two');
  assert.equal(person.resting_place.cemetery, null, 'a full re-save with no cemetery clears the old one, rather than keeping a stale value around');
  assert.equal(person.resting_place.plot, null);
});

test('clearRestingPlace: sets resting_place back to null', () => {
  importFromGedcom([{ id: 'rest4', display_name: 'Rest Four' }], [], { merge: false });
  setRestingPlace('rest4', { cemetery: 'Some Cemetery', place: 'Somewhere' });
  clearRestingPlace('rest4');
  const person = store.getState().people.find((p) => p.id === 'rest4');
  assert.equal(person.resting_place, null);
});

test('setRestingPlace logs a "resting_place_updated" activity event, preferring the cemetery name over the bare place', () => {
  importFromGedcom([{ id: 'rest5', display_name: 'Rest Five' }], [], { merge: false });
  setRestingPlace('rest5', { cemetery: 'Highgate Cemetery', place: 'London, England' });
  const [event] = store.getState().activity;
  assert.equal(event.type, 'resting_place_updated');
  assert.equal(event.personId, 'rest5');
  assert.equal(event.detail, 'Highgate Cemetery', 'the cemetery name is more identifying than the bare place string');
});

test('setRestingPlace logs the place as the detail when no cemetery name was given', () => {
  importFromGedcom([{ id: 'rest6', display_name: 'Rest Six' }], [], { merge: false });
  setRestingPlace('rest6', { place: 'A small churchyard' });
  const [event] = store.getState().activity;
  assert.equal(event.detail, 'A small churchyard');
});

test('clearRestingPlace logs a "resting_place_removed" activity event naming what was removed, even though it no longer exists on the person', () => {
  importFromGedcom([{ id: 'rest7', display_name: 'Rest Seven' }], [], { merge: false });
  setRestingPlace('rest7', { cemetery: 'Green Meadow Cemetery', place: 'Anytown' });
  clearRestingPlace('rest7');
  const [event] = store.getState().activity;
  assert.equal(event.type, 'resting_place_removed');
  assert.equal(event.detail, 'Green Meadow Cemetery');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
