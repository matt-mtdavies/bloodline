/**
 * Unit tests for lib/keepsake.js — the Keepsake's pure data-assembly layer
 * (docs/KEEPSAKE.md Phase 0). Covers: spread inclusion rules, privacy
 * filtering, chapter boundaries, facts-hash stability, and the constellation
 * layout's hard node cap.
 * Run with: node tests/keepsake.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import {
  buildKeepsake,
  buildKeepsakeFacts,
  keepsakeSpreads,
  chapterBoundaries,
  factsHash,
  constellationLayout,
  restrictionOf,
  CONSTELLATION_MAX_NODES,
} from '../src/lib/keepsake.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

// ── Fixture: three generations around Percy ─────────────────────────────────
const P = (id, over = {}) => ({
  id,
  display_name: over.name || id,
  is_living: true,
  is_deceased: false,
  ...over,
});
const par = (from, to) => ({ type: 'parent', from_person: from, to_person: to });

function davies() {
  const people = [
    P('gp1', { name: 'William' }), P('gp2', { name: 'Rita' }),
    P('dad', { name: 'Francis' }), P('mum', { name: 'Dorothy' }),
    P('percy', {
      name: 'Percy',
      gender: 'male',
      birth_date: '1923-05-22',
      birth_place: 'Melbourne, Australia',
      death_date: '1998-03-01',
      is_deceased: true,
      is_living: false,
      occupation: 'Railwayman',
      residence: 'Heidelberg',
      bio: 'A quiet man who loved trains.',
      events: [
        { year: 1943, title: 'Enlisted', tag: 'military' },
        { year: 1950, title: 'Married Verna' },
        { year: 1952, title: 'First child born' },
        { year: 1988, title: 'Retired' },
      ],
      military_branch: 'army',
      military_nation: 'Australia',
    }),
    P('sib', { name: 'Allan' }),
    P('wife', { name: 'Verna' }),
    P('kid1', { name: 'Ken', birth_date: '1952' }), P('kid2', { name: 'Joy', birth_date: '1955' }),
    P('gkid', { name: 'Matt', birth_date: '1980' }),
  ];
  const rels = [
    par('gp1', 'dad'), par('gp2', 'dad'),
    par('dad', 'percy'), par('mum', 'percy'),
    par('dad', 'sib'), par('mum', 'sib'),
    { type: 'partner', from_person: 'percy', to_person: 'wife', partner_status: 'current', is_married: true, marriage_date: '1950-06-10', marriage_place: 'Melbourne' },
    par('percy', 'kid1'), par('wife', 'kid1'),
    par('percy', 'kid2'), par('wife', 'kid2'),
    par('kid1', 'gkid'),
  ];
  return buildGraph(people, rels);
}

const EXTRAS = {
  memories: [
    { id: 'm1', person_id: 'percy', text: 'Knew every platform number.', author: 'Ken', votes: 5, created_at: '2024-01-01' },
    { id: 'm2', person_id: 'percy', text: 'Mint humbugs, always.', author: 'Joy', votes: 2, created_at: '2024-01-02' },
    { id: 'm3', person_id: 'kid1', text: 'Not about Percy.', author: 'X', votes: 9, created_at: '2024-01-03' },
  ],
  photos: [
    { id: 'ph1', person_id: 'percy', src: 'a.jpg', caption: 'At the depot' },
    { id: 'ph2', person_id: 'percy', src: 'b.jpg', caption: '' },
  ],
  documents: [
    { id: 'd1', person_id: 'percy', title: 'Service record', src: 'doc.jpg', extracted: { summary: 'Enlisted 1943 at Royal Park.', facts: [{ year: 1943, title: 'Enlisted', tag: 'military', status: 'accepted' }] } },
  ],
  activity: [{ authorName: 'Matt' }, { authorName: 'Jase' }, { authorName: 'Matt' }],
  familyName: 'The Davies Family',
};

// ── Inclusion rules ─────────────────────────────────────────────────────────

test('a rich subject produces the full spread sequence in fixed order', () => {
  const spreads = keepsakeSpreads(davies(), 'percy', EXTRAS);
  assert.deepEqual(spreads.map((s) => s.key), [
    'cover', 'frontispiece', 'origins', 'constellation', 'chapters',
    'service', 'places', 'voices', 'album', 'documents', 'record', 'legacy', 'colophon',
  ]);
});

test('a bare person still gets the four always-spreads and reads as sparse', () => {
  const g = buildGraph([P('solo', { name: 'Solo' })], []);
  const ks = buildKeepsake(g, 'solo', {});
  assert.deepEqual(ks.spreads.map((s) => s.key), ['cover', 'frontispiece', 'record', 'colophon']);
  assert.equal(ks.sparse, true);
});

test('one photo is not an album; two are', () => {
  const g = davies();
  const one = keepsakeSpreads(g, 'percy', { ...EXTRAS, photos: EXTRAS.photos.slice(0, 1) });
  assert.ok(!one.some((s) => s.key === 'album'));
  const two = keepsakeSpreads(g, 'percy', EXTRAS);
  assert.ok(two.some((s) => s.key === 'album'));
});

test('voices carries only the subject\'s memories, top-voted first', () => {
  const voices = keepsakeSpreads(davies(), 'percy', EXTRAS).find((s) => s.key === 'voices');
  assert.deepEqual(voices.voices.map((v) => v.author), ['Ken', 'Joy']);
});

test('places requires two distinct places and dedupes case-insensitively', () => {
  const g = buildGraph([P('a', { birth_place: 'Cardiff', residence: 'cardiff' })], []);
  assert.ok(!keepsakeSpreads(g, 'a', {}).some((s) => s.key === 'places'));
  // 'Melbourne' (married) and 'Melbourne, Australia' (born) are different
  // strings — dedup is deliberately exact, never fuzzy, so both stand.
  const spread = keepsakeSpreads(davies(), 'percy', EXTRAS).find((s) => s.key === 'places');
  assert.deepEqual(spread.places.map((p) => p.role), ['Born', 'Married', 'Lived']);
});

test('the record spread skips rows with nothing on record', () => {
  const g = buildGraph([P('solo', { name: 'Solo', occupation: 'Baker' })], []);
  const record = keepsakeSpreads(g, 'solo', {}).find((s) => s.key === 'record');
  assert.deepEqual(record.rows, [{ label: 'Occupation', value: 'Baker' }]);
});

test('frontispiece roles are kin words only — occupation never mixed in or lowercased', () => {
  // Percy is a father, grandfather, and husband with an occupation on
  // record: the occupation must NOT join the kin line (it's already the
  // cover epithet, and "husband · partner, hr transformation" reads as a
  // relationship, not a job).
  const front = keepsakeSpreads(davies(), 'percy', EXTRAS).find((s) => s.key === 'frontispiece');
  assert.deepEqual(front.roles, ['father', 'grandfather', 'husband']);
  // No kin roles at all → the occupation stands in, casing untouched.
  const g = buildGraph([P('solo', { name: 'Solo', gender: 'male', occupation: 'Partner, HR Transformation' })], []);
  const soloFront = keepsakeSpreads(g, 'solo', {}).find((s) => s.key === 'frontispiece');
  assert.deepEqual(soloFront.roles, ['Partner, HR Transformation']);
});

test('colophon counts records and names distinct contributors', () => {
  const colophon = keepsakeSpreads(davies(), 'percy', EXTRAS).find((s) => s.key === 'colophon');
  assert.equal(colophon.recordCount, 10 + 3 + 2 + 1); // people + memories + photos + documents
  assert.deepEqual(colophon.contributors, ['Matt', 'Jase']);
  assert.equal(colophon.sparse, false);
});

test('legacy carries descendants and flags a memorial edition for the deceased', () => {
  const legacy = keepsakeSpreads(davies(), 'percy', EXTRAS).find((s) => s.key === 'legacy');
  assert.deepEqual(legacy.children.map((c) => c.name), ['Ken', 'Joy']);
  assert.equal(legacy.grandchildren.length, 1);
  assert.equal(legacy.youngestYear, 1980);
  assert.equal(legacy.memorial, true);
});

// ── Privacy ─────────────────────────────────────────────────────────────────

test('a private subject cannot be generated at all', () => {
  const g = buildGraph([P('x', { visibility: 'private' })], []);
  assert.equal(buildKeepsake(g, 'x', {}), null);
  assert.equal(buildKeepsakeFacts(g, 'x', {}), null);
  assert.equal(keepsakeSpreads(g, 'x', {}), null);
});

test('private relatives are excluded everywhere; summary relatives are name-only', () => {
  const g = buildGraph([
    P('me', { name: 'Me' }),
    P('secret', { name: 'Secret', visibility: 'private' }),
    P('quiet', { name: 'Quiet', visibility: 'summary', photo: 'q.jpg' }),
  ], [par('secret', 'me'), par('quiet', 'me')]);
  const layout = constellationLayout(g, 'me');
  assert.ok(!layout.nodes.some((n) => n.id === 'secret'));
  const quiet = layout.nodes.find((n) => n.id === 'quiet');
  assert.equal(quiet.photo, null);
  assert.equal(quiet.restricted, true);
  const facts = buildKeepsakeFacts(g, 'me', {});
  assert.deepEqual(facts.family.parents, ['Quiet']);
});

test('a living minor keeps name + portrait but is flagged restricted', () => {
  const g = buildGraph([
    P('dad', { name: 'Dad' }),
    P('kid', { name: 'Kid', is_minor: true, photo: 'k.jpg' }),
  ], [par('dad', 'kid')]);
  assert.equal(restrictionOf(g.byId.get('kid')), 'minor');
  const node = constellationLayout(g, 'dad').nodes.find((n) => n.id === 'kid');
  assert.equal(node.photo, 'k.jpg');
  assert.equal(node.restricted, true);
});

// ── Chapters ────────────────────────────────────────────────────────────────

test('chapterBoundaries cuts at ages 18/40/65 and merges empty bands', () => {
  const events = [
    { year: '1943', title: 'Enlisted' },   // age 20 → early years
    { year: '1950', title: 'Married' },    // age 27 → early years
    { year: '1988', title: 'Retired' },    // age 65 → later years
  ];
  const chapters = chapterBoundaries(events, '1923', '1998');
  // childhood (empty → merged), early years, mid-life (empty → merged), later years
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].fromYear, 1923); // absorbed the empty childhood band
  assert.deepEqual(chapters[0].events.map((e) => e.title), ['Enlisted', 'Married']);
  assert.equal(chapters[1].toYear, 1998);
  assert.deepEqual(chapters[1].events.map((e) => e.title), ['Retired']);
});

test('chapterBoundaries without a birth year splits evenly, capped at 3', () => {
  const events = Array.from({ length: 12 }, (_, i) => ({ year: String(1950 + i), title: `E${i}` }));
  const chapters = chapterBoundaries(events, null, null);
  assert.equal(chapters.length, 3);
  assert.equal(chapters.flatMap((c) => c.events).length, 12);
});

test('an event-less life still yields one chapter; no events and no birth yields none', () => {
  assert.equal(chapterBoundaries([], '1950', null, 2026).length, 1);
  assert.equal(chapterBoundaries([], null, null).length, 0);
});

test('a living person\'s final chapter runs to the injected now-year', () => {
  const chapters = chapterBoundaries([{ year: '2000', title: 'X' }], '1980', null, 2026);
  assert.equal(chapters[chapters.length - 1].toYear, 2026);
});

// ── Hash ────────────────────────────────────────────────────────────────────

test('factsHash is stable for identical facts and changes when a record changes', () => {
  const g = davies();
  const a = factsHash(buildKeepsakeFacts(g, 'percy', EXTRAS));
  const b = factsHash(buildKeepsakeFacts(g, 'percy', EXTRAS));
  assert.equal(a, b);
  const grew = { ...EXTRAS, memories: [...EXTRAS.memories, { id: 'm4', person_id: 'percy', text: 'New memory.', author: 'Jase', votes: 0 }] };
  assert.notEqual(a, factsHash(buildKeepsakeFacts(g, 'percy', grew)));
});

// ── Constellation ───────────────────────────────────────────────────────────

test('constellation places generations on their bands with the subject at the origin', () => {
  const { nodes, links } = constellationLayout(davies(), 'percy');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  assert.deepEqual([byId.get('percy').x, byId.get('percy').y], [0, 0]);
  assert.equal(byId.get('dad').y, -1);
  assert.equal(byId.get('gp1').y, -2);
  assert.equal(byId.get('kid1').y, 1);
  assert.equal(byId.get('gkid').y, 2);
  assert.equal(byId.get('wife').y, 0);
  assert.ok(links.some((l) => l.kind === 'partner' && l.to === 'wife'));
  assert.ok(links.every((l) => byId.has(l.from) && byId.has(l.to)), 'no link may reference an unplaced node');
});

test('constellation enforces the hard node cap on a huge family', () => {
  const people = [P('root', { name: 'Root' })];
  const rels = [];
  for (let i = 0; i < 80; i++) {
    people.push(P(`c${i}`, { name: `C${i}` }));
    rels.push(par('root', `c${i}`));
  }
  const { nodes, links } = constellationLayout(buildGraph(people, rels), 'root');
  assert.equal(nodes.length, CONSTELLATION_MAX_NODES);
  const ids = new Set(nodes.map((n) => n.id));
  assert.ok(links.every((l) => ids.has(l.from) && ids.has(l.to)));
});

// ── buildKeepsake top level ─────────────────────────────────────────────────

test('buildKeepsake bundles subject, spreads, facts, and a hash', () => {
  const ks = buildKeepsake(davies(), 'percy', EXTRAS);
  assert.equal(ks.subject.name, 'Percy');
  assert.equal(ks.sparse, false);
  assert.equal(typeof ks.factsHash, 'string');
  assert.ok(ks.spreads.length >= 10);
  assert.equal(ks.facts.military.branch, 'army');
  assert.deepEqual(ks.facts.family.children, ['Ken', 'Joy']);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
