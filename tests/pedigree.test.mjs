import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { computePedigree, primaryUnionPartner, childrenOfUnion, unionCandidates } from '../src/viz/pedigreeLayout.js';
import { PLATE_W, LINK_GAP } from '../src/viz/pedigreeMetrics.js';

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
  // matthew is member A (line member first): step edge to A, bio to B. A
  // step edge to the OTHER member no longer counts toward "both" for
  // connector-origin purposes — only two REAL (bio/adoptive) edges do — so
  // this hangs from kaitlin's (B's) own plate specifically, matching what
  // this test's own title always said. Real report, with a screenshot: the
  // old 'both' behaviour drew this from the couple's shared middle instead.
  assert.equal(step.side, 'b', 'hangs from kaitlin\'s own plate, not the shared middle');
  const conn = connectors.find((c) => c.toCardId === 'c_stepkid');
  assert.ok(conn);
  assert.equal(conn.side, 'b');
});

t('a blended couple where BOTH members bring their own kids, each cross-recorded step to the other, splits into two separate buses', () => {
  // The exact reported shape: "the lines coming from Ken and Heather should
  // be individual. Matthew and Jason, being Heather's children, should come
  // off her card, and Jessica and Amie, Ken's biological daughters, should
  // come off Ken's card." Heather's kids carry an explicit step edge to Ken
  // (and vice versa) — the courtesy record for "my partner's kids are my
  // step-kids" — which must NOT pull them into the shared middle.
  const bp = ['heather', 'ken', 'matthewK', 'jasonK', 'jessica', 'amie'].map(person);
  const brel = [
    ptn('heather', 'ken', 'current'),
    par('heather', 'matthewK'), par('ken', 'matthewK', 'step'),
    par('heather', 'jasonK'), par('ken', 'jasonK', 'step'),
    par('ken', 'jessica'), par('heather', 'jessica', 'step'),
    par('ken', 'amie'), par('heather', 'amie', 'step'),
  ];
  const bg = buildGraph(bp, brel);
  const { cards, connectors } = computePedigree(bg, 'heather', { expandedUp: new Set() });
  const byName = (id) => cards.find((c) => c.kind === 'child' && c.members[0] === id);
  // heather is the focus (member A); ken is her displayed partner (member B).
  assert.equal(byName('matthewK').side, 'a', 'heather\'s own child hangs from her side');
  assert.equal(byName('jasonK').side, 'a');
  assert.equal(byName('jessica').side, 'b', 'ken\'s own child hangs from his side');
  assert.equal(byName('amie').side, 'b');
  const sideOfConn = (id) => connectors.find((c) => c.toCardId === byName(id).id).side;
  assert.equal(sideOfConn('matthewK'), 'a');
  assert.equal(sideOfConn('jessica'), 'b');
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

t('horizontal orientation maps ancestors left and children right of focal', () => {
  const expandedUp = new Set(['matthew']);
  const { cards, focalCardId } = computePedigree(graph, 'matthew', { expandedUp, orientation: 'horizontal' });
  const focal = cards.find((c) => c.id === focalCardId);
  const anc = cards.find((c) => c.kind === 'ancestor');
  const child = cards.find((c) => c.kind === 'child');
  assert.ok(Math.abs(focal.x) < 1e-9, 'focal stays at the origin'); // -0 is a valid "0" here
  assert.ok(anc.x < focal.x, 'ancestors recede to the left');
  assert.ok(child.x > focal.x, 'children sit to the right');
});

t('horizontal deep expansion stacks generations without vertical overlap', () => {
  const expandedUp = new Set(['matthew', 'kaitlin', 'heather', 'chris', 'cathy', 'richard']);
  const { cards } = computePedigree(graph, 'matthew', { expandedUp, orientation: 'horizontal' });
  // In landscape the cross axis is vertical: within a generation column (same
  // x), cards must not overlap in y.
  const byGen = new Map();
  for (const c of cards.filter((c) => c._gen >= 0)) {
    if (!byGen.has(c._gen)) byGen.set(c._gen, []);
    byGen.get(c._gen).push(c);
  }
  for (const [, col] of byGen) {
    col.sort((a, b) => a.y - b.y);
    for (let i = 1; i < col.length; i++) {
      assert.ok(col[i].y - col[i].h / 2 >= col[i - 1].y + col[i - 1].h / 2 - 1,
        `vertical overlap in gen column between ${col[i - 1].id} and ${col[i].id}`);
    }
  }
});

t('horizontal couple card is one plate wide, two plates tall', () => {
  const { cards, focalCardId } = computePedigree(graph, 'matthew', { expandedUp: new Set(), orientation: 'horizontal' });
  const focal = cards.find((c) => c.id === focalCardId);
  assert.equal(focal.members.length, 2);
  // One plate wide (PLATE_W=192), two plates + the seam gap tall (60*2+18=138).
  assert.equal(focal.w, 192);
  assert.equal(focal.h, 138);
});

t('a lopsided ancestor branch stays near its own member, not dragged toward its partner\'s wide branch', () => {
  // "kid"'s parents: "wide" (whose own ancestry expands 2 more generations
  // deep) and "narrow" (whose parents are recorded but have no further
  // ancestors of their own — a real, common shape: one side of a family is
  // well researched, the other barely). Real report, with a screenshot: the
  // narrow side's parent card rendered "far to the right" of the person it
  // actually belongs to, dragged out by how wide the OTHER side's branch was.
  const p2 = ['kid', 'wide', 'narrow', 'wA', 'wB', 'wAp1', 'wAp2', 'wBp1', 'wBp2', 'nA', 'nB'].map(person);
  const r2 = [
    ptn('wide', 'narrow'),
    par('wide', 'kid'), par('narrow', 'kid'),
    par('wA', 'wide'), par('wB', 'wide'),
    par('wAp1', 'wA'), par('wAp2', 'wA'),
    par('wBp1', 'wB'), par('wBp2', 'wB'),
    par('nA', 'narrow'), par('nB', 'narrow'),
  ];
  const g2 = buildGraph(p2, r2);
  const expandedUp = new Set(['kid', 'wide', 'narrow', 'wA', 'wB']); // expand every available generation
  const { cards } = computePedigree(g2, 'kid', { expandedUp });
  // kid's own parent card: wide (member 0, left) + narrow (member 1, right).
  const parentCard = cards.find((c) => c.kind === 'ancestor' && c.members.includes('wide') && c.members.includes('narrow'));
  // narrow's OWN parents (nA+nB) — one generation further up, un-expandable
  // (a real, common shape: one side of the family well researched, the
  // other barely) — vs. wide's own parents (wA+wB), which keep going another
  // generation deeper still.
  const narrowGrandCard = cards.find((c) => c.kind === 'ancestor' && c.members.includes('nA'));
  const wideGrandCard = cards.find((c) => c.kind === 'ancestor' && c.members.includes('wA'));
  assert.ok(narrowGrandCard && wideGrandCard, 'both grandparent cards drawn');
  // narrow's own plate sits on the right half of the wide+narrow card — its
  // OWN parents should land close to that x, not dragged out toward wide's
  // much wider (one generation deeper) branch.
  const narrowPlateX = parentCard.x + PLATE_W / 2 + LINK_GAP / 2;
  assert.ok(Math.abs(narrowGrandCard.x - narrowPlateX) < PLATE_W,
    `narrow's own parents (x=${narrowGrandCard.x}) should stay near narrow's own plate (x≈${narrowPlateX}), not drift toward wide's branch (x=${wideGrandCard.x})`);
});

// ── Descent connector origin: a child linked to only one displayed member
//    hangs from that member's own plate, not the couple's shared middle
//    (real feedback: "if steps, then the line comes from the middle of the
//    parents tile, not the middle of the couple"). A second design — showing
//    every partnership with shared children as its own sibling pod at once —
//    was tried and reverted (real feedback on the live result: two pods for
//    the same person, with no visual link between them, read as two
//    unrelated couples) — see git history if revisited. Only one partnership
//    is ever displayed at a time now, exactly as before that experiment. ───

t('a child linked to only the non-focus member of a pod is side "b" — a dashed, dedicated connector', () => {
  // A small dedicated fixture: focus person "sam" partners "robin" (no shared
  // kids), and robin separately has a child "kim" with someone with NO
  // recorded edge to sam at all — kim ends up side 'b' for a different
  // reason than the gauntlet family's stepkid just above (no edge to sam at
  // all here, vs. a real 'step' edge to matthew there) but the same visual
  // result either way: hung from robin's own plate, not the couple's middle.
  const p2 = ['sam', 'robin', 'kim', 'other'].map(person);
  const r2 = [ptn('sam', 'robin', 'current'), par('robin', 'kim'), par('other', 'kim')];
  const g2 = buildGraph(p2, r2);
  const { cards, connectors } = computePedigree(g2, 'sam', { expandedUp: new Set() });
  const focal = cards.find((c) => c.members.includes('sam') && c.members.includes('robin'));
  const kimCard = cards.find((c) => c.kind === 'child' && c.members[0] === 'kim');
  assert.equal(kimCard.side, 'b');
  const conn = connectors.find((c) => c.toCardId === kimCard.id);
  assert.equal(conn.side, 'b');
});

// ── Bloodline mode: step children filtered, bio + adopted kept ──────────────
{
  const bp = ['dad', 'mum', 'bioKid', 'adoptKid', 'pureStep', 'exPartner', 'newWife'].map(person);
  const brel = [
    ptn('dad', 'mum'),
    par('dad', 'bioKid'), par('mum', 'bioKid'),
    par('dad', 'adoptKid', 'adopted'), par('mum', 'adoptKid', 'adopted'),
    // pureStep is the ex-partner's biological child; dad is only a step-parent,
    // mum is unrelated — a social bond, not a bloodline.
    par('exPartner', 'pureStep'), par('dad', 'pureStep', 'step'),
    // newWife is dad's current partner with NO children together — a purely
    // social pairing that bloodline mode must never display or offer.
    ptn('dad', 'newWife', 'current'),
  ];
  const bg = buildGraph(bp, brel);

  t('bloodline off: step child shows alongside bio + adopted', () => {
    const rows = childrenOfUnion(bg, 'dad', 'mum', false).map((r) => r.id);
    assert.deepEqual(new Set(rows), new Set(['bioKid', 'adoptKid', 'pureStep']));
  });
  t('bloodline on: pure step child filtered; biological + adopted kept', () => {
    const rows = childrenOfUnion(bg, 'dad', 'mum', true).map((r) => r.id);
    assert.deepEqual(new Set(rows), new Set(['bioKid', 'adoptKid']));
  });
  t('bloodline on: focal childrenCount reflects the filtered set', () => {
    const all = computePedigree(bg, 'dad', { expandedUp: new Set() });
    const blood = computePedigree(bg, 'dad', { expandedUp: new Set(), bloodlineOnly: true });
    assert.equal(all.cards.find((c) => c.id === all.focalCardId).childrenCount, 3);
    assert.equal(blood.cards.find((c) => c.id === blood.focalCardId).childrenCount, 2);
    assert.ok(!blood.cards.some((c) => c.id === 'c_pureStep'), 'no step child card drawn');
  });

  t('bloodline on: switcher offers only biological co-parents (drops social)', () => {
    const all = unionCandidates(bg, 'dad', false).map((c) => c.id).sort();
    const blood = unionCandidates(bg, 'dad', true).map((c) => c.id).sort();
    assert.deepEqual(all, ['mum', 'newWife']);   // both partners normally
    assert.deepEqual(blood, ['mum']);            // only the bloodline co-parent
  });
  t('bloodline on: default focal partner is the bloodline co-parent, not the social spouse', () => {
    assert.equal(primaryUnionPartner(bg, 'dad', false), 'mum'); // most shared children
    assert.equal(primaryUnionPartner(bg, 'dad', true), 'mum');
  });
  t('bloodline on: a purely-social pairing yields a solo card (no partner)', () => {
    // newWife has no bloodline children with anyone → stands solo in bloodline.
    assert.equal(primaryUnionPartner(bg, 'newWife', true), null);
    const { cards, focalCardId } = computePedigree(bg, 'newWife', { expandedUp: new Set(), bloodlineOnly: true });
    assert.deepEqual(cards.find((c) => c.id === focalCardId).members, ['newWife']);
  });
  t('bloodline on: a stale social-partner choice is ignored, falls back to bloodline default', () => {
    const partnerChoice = new Map([['dad', 'newWife']]);
    const { cards, focalCardId } = computePedigree(bg, 'dad', { expandedUp: new Set(), partnerChoice, bloodlineOnly: true });
    const focal = cards.find((c) => c.id === focalCardId);
    assert.deepEqual(focal.members.slice().sort(), ['dad', 'mum']);
    // ...and the children stay the bloodline set, correctly attributed.
    assert.equal(focal.childrenCount, 2);
  });
  t('bloodline off: the social spouse choice is honoured (unchanged behaviour)', () => {
    const partnerChoice = new Map([['dad', 'newWife']]);
    const { cards, focalCardId } = computePedigree(bg, 'dad', { expandedUp: new Set(), partnerChoice });
    assert.deepEqual(cards.find((c) => c.id === focalCardId).members.slice().sort(), ['dad', 'newWife']);
  });
}

process.exit(failures ? 1 : 0);
