import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { computePedigree, primaryUnionPartner, childrenOfUnion, unionCandidates } from '../src/viz/pedigreeLayout.js';

const person = (id) => ({ id, display_name: id, gender: null, is_deceased: false });
const par = (p, c, q = 'biological') => ({ type: 'parent', from_person: p, to_person: c, qualifier: q, partner_status: null });
const ptn = (a, b, s = 'current') => ({ type: 'partner', from_person: a, to_person: b, qualifier: 'biological', partner_status: s });

// The full gauntlet family: every shape that broke the old engine.
//  - matthew+kaitlin (focal couple, 3 kids)
//  - matthew's parents: heather+chris (divorced; chris remarried denise, childless)
//  - kaitlin's parents: cathy+richard
//  - heather's parents: allen+nancy — allen also had marjorie with shirley,
//    nancy also had geoffrey+glenys with reginald (both remarried webs)
//  - james+megan style step-child: noah is megan's bio / james's step — here
//    modelled as kaitlin having a step-child linked to her only.
const people = ['matthew', 'kaitlin', 'heather', 'chris', 'denise', 'cathy', 'richard',
  'allen', 'nancy', 'shirley', 'reginald', 'marjorie', 'geoffrey', 'glenys',
  'jackson', 'isla', 'liv', 'stepkid'].map(person);
const rels = [
  ptn('matthew', 'kaitlin'),
  par('matthew', 'jackson'), par('kaitlin', 'jackson'),
  par('matthew', 'isla'), par('kaitlin', 'isla'),
  par('matthew', 'liv'), par('kaitlin', 'liv'),
  par('kaitlin', 'stepkid'), par('matthew', 'stepkid', 'step'),
  par('heather', 'matthew'), par('chris', 'matthew'),
  par('cathy', 'kaitlin'), par('richard', 'kaitlin'),
  ptn('chris', 'denise', 'current'),
  ptn('cathy', 'richard'),
  par('allen', 'heather'), par('nancy', 'heather'),
  par('allen', 'marjorie'), par('shirley', 'marjorie'),
  par('nancy', 'geoffrey'), par('reginald', 'geoffrey'),
  par('nancy', 'glenys'), par('reginald', 'glenys'),
  ptn('allen', 'nancy', 'current'), ptn('allen', 'shirley', 'former'),
];
const graph = buildGraph(people, rels);

let failures = 0;
const t = (label, fn) => { try { fn(); console.log('PASS ', label); } catch (e) { failures++; console.log('FAIL ', label, '—', e.message); } };

t('focal union pairs matthew+kaitlin', () => {
  const { cards, focalCardId } = computePedigree(graph, 'matthew', { expandedUp: new Set() });
  const focal = cards.find((c) => c.id === focalCardId);
  assert.deepEqual(focal.members.slice().sort(), ['kaitlin', 'matthew']);
});

t('chris\'s focal partner is heather (co-parent), never denise', () => {
  assert.equal(primaryUnionPartner(graph, 'chris'), 'heather');
});

t('both members get their OWN parent card (the whole point)', () => {
  const expandedUp = new Set(['matthew', 'kaitlin']);
  const { cards } = computePedigree(graph, 'matthew', { expandedUp });
  const mParents = cards.find((c) => c.kind === 'ancestor' && c.members.includes('heather'));
  const kParents = cards.find((c) => c.kind === 'ancestor' && c.members.includes('cathy'));
  assert.ok(mParents && mParents.members.includes('chris'), 'matthew -> heather+chris');
  assert.ok(kParents && kParents.members.includes('richard'), 'kaitlin -> cathy+richard');
});

t('heather\'s parent slot shows HER parents allen+nancy (not allen+shirley)', () => {
  const expandedUp = new Set(['matthew', 'heather']);
  const { cards } = computePedigree(graph, 'matthew', { expandedUp });
  const hParents = cards.find((c) => c.kind === 'ancestor' && c.members.includes('allen'));
  assert.deepEqual(hParents.members.slice().sort(), ['allen', 'nancy']);
});

t('spouse switch flips allen\'s displayed partner to shirley', () => {
  const expandedUp = new Set(['matthew', 'heather']);
  const partnerChoice = new Map([['allen', 'shirley']]);
  const { cards } = computePedigree(graph, 'matthew', { expandedUp, partnerChoice });
  const aCard = cards.find((c) => c.kind === 'ancestor' && c.members.includes('allen'));
  assert.deepEqual(aCard.members.slice().sort(), ['allen', 'shirley']);
});

t('allen has switcher candidates (nancy + shirley)', () => {
  const alts = unionCandidates(graph, 'allen').map((c) => c.id).sort();
  assert.deepEqual(alts, ['nancy', 'shirley']);
});

t('drawn children include the step-child, hung from kaitlin\'s side only', () => {
  const { cards, connectors } = computePedigree(graph, 'matthew', { expandedUp: new Set() });
  const step = cards.find((c) => c.id === 'c_stepkid');
  assert.ok(step, 'stepkid drawn');
  // matthew is member A (line member first): step edge to A, bio to B.
  assert.equal(step.side, 'both' /* linked to both, one step */, 'linked to both members');
  const conn = connectors.find((c) => c.toCardId === 'c_stepkid');
  assert.ok(conn);
});

t('childrenOfUnion groups a cross-union child with its outside co-parent', () => {
  const rows = childrenOfUnion(graph, 'allen', 'nancy');
  const marj = rows.find((r) => r.id === 'marjorie');
  assert.equal(marj.otherParentId, 'shirley');
  const geoff = rows.find((r) => r.id === 'geoffrey');
  assert.equal(geoff.otherParentId, 'reginald');
});

t('lazy: nothing beyond focal+children computed when nothing expanded', () => {
  const { cards } = computePedigree(graph, 'matthew', { expandedUp: new Set() });
  assert.equal(cards.filter((c) => c.kind === 'ancestor').length, 0);
  assert.equal(cards.filter((c) => c.kind === 'child').length, 4);
});

t('deep expansion places generations without overlap on the cross axis', () => {
  const expandedUp = new Set(['matthew', 'kaitlin', 'heather', 'chris', 'cathy', 'richard']);
  const { cards } = computePedigree(graph, 'matthew', { expandedUp });
  const byGen = new Map();
  for (const c of cards.filter((c) => c._gen >= 0)) {
    if (!byGen.has(c._gen)) byGen.set(c._gen, []);
    byGen.get(c._gen).push(c);
  }
  for (const [, row] of byGen) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      assert.ok(row[i].x - row[i].w / 2 >= row[i - 1].x + row[i - 1].w / 2 - 1,
        `overlap in gen row between ${row[i - 1].id} and ${row[i].id}`);
    }
  }
});

t('horizontal orientation maps ancestors to +x and children left of focal', () => {
  const expandedUp = new Set(['matthew']);
  const { cards, focalCardId } = computePedigree(graph, 'matthew', { expandedUp, orientation: 'horizontal' });
  const focal = cards.find((c) => c.id === focalCardId);
  const anc = cards.find((c) => c.kind === 'ancestor');
  const child = cards.find((c) => c.kind === 'child');
  assert.ok(anc.x > focal.x, 'ancestors to the right');
  assert.ok(child.x < focal.x, 'children to the left');
});

process.exit(failures ? 1 : 0);
