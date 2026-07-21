/**
 * Unit tests for lib/cinematicTimeline.js — the Cinematic Timeline "director".
 * Pure story-compilation: a person + graph → an ordered script of beats.
 * Run with: node tests/cinematicTimeline.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { buildCinematicScript, BEAT_KINDS, DWELL_MS } from '../src/lib/cinematicTimeline.js';

let passed = 0, failed = 0;
function test(label, fn) {
  try { fn(); passed++; console.log(`PASS  ${label}`); }
  catch (e) { failed++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}

const person = (id, extra = {}) => ({ id, display_name: id, is_deceased: false, ...extra });
const parentEdge = (parentId, childId, qualifier = 'biological') => ({
  type: 'parent', from_person: parentId, to_person: childId, qualifier, partner_status: null,
});
const partnerEdge = (a, b, status = 'current', extra = {}) => ({
  type: 'partner', from_person: a, to_person: b, qualifier: 'biological', partner_status: status, ...extra,
});

const kinds = (script) => script.beats.map((b) => b.kind);
const yearsAscending = (script) => script.beats.every((b, i, arr) => i === 0 || arr[i - 1].year <= b.year);

// A small, complete family: two parents, subject, one sibling, a spouse, a child.
function sampleGraph() {
  return buildGraph(
    [
      person('dad', { display_name: 'Henry Vale', birth_date: '1955', gender: 'male' }),
      person('mum', { display_name: 'Rose Vale', birth_date: '1957', gender: 'female' }),
      person('subj', { display_name: 'James Vale', birth_date: '1985-04-12', gender: 'male', birth_place: 'Cardiff, Wales',
        events: [{ year: 2007, title: 'Graduated', detail: 'Architecture' }, { year: 2012, title: 'Became a father', detail: 'Oliver born' }] }),
      person('sis', { display_name: 'Sarah Vale', birth_date: '1988', gender: 'female' }),
      person('wife', { display_name: 'Megan Vale', birth_date: '1987', gender: 'female' }),
      person('kid', { display_name: 'Oliver Vale', birth_date: '2012', gender: 'male' }),
    ],
    [
      parentEdge('dad', 'subj'), parentEdge('mum', 'subj'),
      parentEdge('dad', 'sis'), parentEdge('mum', 'sis'),
      parentEdge('subj', 'kid'), parentEdge('wife', 'kid'),
      partnerEdge('subj', 'wife', 'current', { is_married: true, marriage_date: '2010', marriage_place: 'Bristol' }),
    ],
  );
}

// ── Structure & ordering ────────────────────────────────────────────────────

test('beats come out ordered chronologically', () => {
  const s = buildCinematicScript(sampleGraph(), 'subj', { nowYear: 2025 });
  assert.ok(yearsAscending(s), 'beats must be sorted by year');
});

test('every beat kind is a declared BEAT_KIND, and dwellMs follows pacing', () => {
  const s = buildCinematicScript(sampleGraph(), 'subj', { nowYear: 2025 });
  for (const b of s.beats) {
    assert.ok(BEAT_KINDS.includes(b.kind), `unknown kind ${b.kind}`);
    assert.equal(b.dwellMs, DWELL_MS[b.pacing], `dwellMs should match pacing bucket for ${b.kind}`);
  }
});

test('opens on the parents before the subject exists, then the birth', () => {
  const s = buildCinematicScript(sampleGraph(), 'subj', { nowYear: 2025 });
  const opening = s.beats.find((b) => b.kind === 'opening');
  const birth = s.beats.find((b) => b.kind === 'birth');
  assert.ok(opening, 'an opening beat should exist when parents are known');
  assert.ok(birth, 'a birth beat should exist');
  assert.ok(opening.year < birth.year, 'opening precedes birth');
  assert.deepEqual(opening.cast.sort(), ['dad', 'mum'], 'opening frames the parents');
  assert.equal(birth.focus, 'subj');
  assert.equal(birth.setPiece, 'birth-glow');
});

test('a spouse produces a marriage beat at the marriage year, focused beside the subject', () => {
  const s = buildCinematicScript(sampleGraph(), 'subj', { nowYear: 2025 });
  const m = s.beats.find((b) => b.kind === 'marriage');
  assert.ok(m, 'marriage beat exists');
  assert.equal(m.year, 2010, 'uses the edge marriage_date');
  assert.equal(m.detail, 'Bristol', 'carries the marriage place');
  assert.ok(m.cast.includes('wife') && m.cast.includes('subj'));
});

test('each child born produces a child beat with the birth set-piece', () => {
  const s = buildCinematicScript(sampleGraph(), 'subj', { nowYear: 2025 });
  const c = s.beats.find((b) => b.kind === 'child');
  assert.ok(c, 'child beat exists');
  assert.equal(c.year, 2012);
  assert.equal(c.setPiece, 'birth-glow');
  assert.equal(c.focus, 'kid');
});

test('a sibling with a known birth year gets its own beat', () => {
  const s = buildCinematicScript(sampleGraph(), 'subj', { nowYear: 2025 });
  const sib = s.beats.find((b) => b.kind === 'sibling');
  assert.ok(sib, 'sibling beat exists');
  assert.equal(sib.year, 1988);
});

test('"became a father" milestone is suppressed in favour of the child\'s own beat', () => {
  const s = buildCinematicScript(sampleGraph(), 'subj', { nowYear: 2025 });
  const milestones = s.beats.filter((b) => b.kind === 'milestone');
  assert.ok(milestones.some((b) => /graduated/i.test(b.title)), 'the graduation milestone survives');
  assert.ok(!milestones.some((b) => /became a father/i.test(b.title)), 'the parenthood milestone is folded into the child beat');
});

// ── Endings ─────────────────────────────────────────────────────────────────

test('a living subject ends on a "present" beat — no death or legacy', () => {
  const s = buildCinematicScript(sampleGraph(), 'subj', { nowYear: 2025 });
  assert.ok(kinds(s).includes('present'), 'present beat exists');
  assert.ok(!kinds(s).includes('death'), 'no death beat for a living person');
  assert.ok(!kinds(s).includes('legacy'), 'no legacy beat for a living person');
  assert.equal(s.beats[s.beats.length - 1].kind, 'present', 'present is the final beat');
});

test('a deceased subject ends on death then legacy, with living descendants illuminated', () => {
  const g = buildGraph(
    [
      person('gp', { display_name: 'Arthur Vale', birth_date: '1928', death_date: '2009', is_deceased: true }),
      person('child', { display_name: 'Robert Vale', birth_date: '1958' }),
      person('grandchild', { display_name: 'James Vale', birth_date: '1985' }),
    ],
    [parentEdge('gp', 'child'), parentEdge('child', 'grandchild')],
  );
  const s = buildCinematicScript(g, 'gp', { nowYear: 2025 });
  const k = kinds(s);
  assert.ok(k.includes('death') && k.includes('legacy'), 'death and legacy both present');
  assert.ok(k.indexOf('death') < k.indexOf('legacy'), 'death precedes legacy');
  const legacy = s.beats.find((b) => b.kind === 'legacy');
  assert.equal(legacy.setPiece, 'legacy-bloom');
  assert.ok(legacy.cast.includes('child') && legacy.cast.includes('grandchild'), 'living descendants are in the legacy frame');
});

test('a parent who dies within the subject\'s lifetime gets a parent_death beat', () => {
  const g = buildGraph(
    [
      person('dad', { display_name: 'Henry Vale', birth_date: '1955', death_date: '2020', is_deceased: true }),
      person('subj', { display_name: 'James Vale', birth_date: '1985' }),
    ],
    [parentEdge('dad', 'subj')],
  );
  const s = buildCinematicScript(g, 'subj', { nowYear: 2025 });
  const pd = s.beats.find((b) => b.kind === 'parent_death');
  assert.ok(pd, 'parent_death beat exists');
  assert.equal(pd.year, 2020);
  assert.equal(pd.setPiece, 'death-fade');
  assert.equal(pd.focus, 'dad');
});

// ── Sparse / messy data ─────────────────────────────────────────────────────

test('never returns an empty script, even for a bare name-only stub', () => {
  const g = buildGraph([person('lonely', { display_name: 'Unknown Ancestor' })], []);
  const s = buildCinematicScript(g, 'lonely', { nowYear: 2025 });
  assert.ok(s.beats.length >= 1, 'at least one beat is produced');
});

test('a missing subject birth year is estimated and flagged, never fabricated as fact', () => {
  const g = buildGraph(
    [
      person('dad', { display_name: 'Henry Vale', birth_date: '1930' }),
      person('subj', { display_name: 'James Vale', events: [{ year: 1960, title: 'Emigrated' }] }),
    ],
    [parentEdge('dad', 'subj')],
  );
  const s = buildCinematicScript(g, 'subj', { nowYear: 2025 });
  const birth = s.beats.find((b) => b.kind === 'birth');
  assert.ok(birth, 'still produces a birth beat off an estimate');
  assert.equal(birth.estimated, true, 'the estimated year is flagged so the renderer can soften it');
  assert.ok(birth.year < 1960, 'the estimate precedes the earliest known event');
});

test('a marriage with no known year produces no dated marriage beat (never invents a wedding)', () => {
  const g = buildGraph(
    [
      person('subj', { display_name: 'James Vale', birth_date: '1985' }),
      person('wife', { display_name: 'Megan Vale', birth_date: '1987' }),
    ],
    [partnerEdge('subj', 'wife', 'current')], // no marriage_date, no "Married" event
  );
  const s = buildCinematicScript(g, 'subj', { nowYear: 2025 });
  assert.ok(!kinds(s).includes('marriage'), 'no marriage beat without a real year');
});

test('an unknown-birth-year child is left out of dated beats but still counted in legacy', () => {
  const g = buildGraph(
    [
      person('subj', { display_name: 'Arthur Vale', birth_date: '1928', death_date: '2009', is_deceased: true }),
      person('kid', { display_name: 'Robert Vale' }), // no birth_date
    ],
    [parentEdge('subj', 'kid')],
  );
  const s = buildCinematicScript(g, 'subj', { nowYear: 2025 });
  assert.ok(!s.beats.some((b) => b.kind === 'child'), 'no dated child beat without a year');
  const legacy = s.beats.find((b) => b.kind === 'legacy');
  assert.ok(legacy.cast.includes('kid'), 'the child still appears in the legacy frame');
});

// ── Quiet-stretch world context ─────────────────────────────────────────────

test('a long quiet gap gets a world-context beat; a busy life needs none', () => {
  // Cardiff → UK region; a long gap between birth (1900) and death (1980).
  const g = buildGraph(
    [person('subj', { display_name: 'Idris Vale', birth_date: '1900', death_date: '1980', is_deceased: true, birth_place: 'Cardiff, Wales' })],
    [],
  );
  const s = buildCinematicScript(g, 'subj', { nowYear: 2025 });
  assert.ok(s.beats.some((b) => b.kind === 'world'), 'an 80-year span with no events earns world context');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
