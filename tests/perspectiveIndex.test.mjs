/**
 * Unit tests for src/lib/perspectiveIndex.js — the Family Perimeter Phase 2
 * Perspective Index (docs/FAMILY-PERIMETER-AND-5000-PERSON-PERFORMANCE.md
 * §3/§6.6/§11.1). Covers the §11.1 relationship-case matrix with small,
 * hand-crafted fixtures, plus determinism/cycle-safety/performance property
 * tests reusing the Phase 0 synthetic fixture generator.
 *
 * Run with: node tests/perspectiveIndex.test.mjs
 */
import assert from 'node:assert/strict';
import { buildGraph } from '../src/data/graph.js';
import { computePerspectiveIndex, computeInsightCohorts } from '../src/lib/perspectiveIndex.js';
import { generateFamilyFixture, generateCorruptCycleFixture } from '../src/lib/fixtureGenerator.js';

let passed = 0, failed = 0;
const results = [];
function test(label, fn) {
  try { fn(); passed++; results.push({ ok: true, label }); }
  catch (e) { failed++; results.push({ ok: false, label, error: e.stack || e.message }); }
}

const person = (id, gender = null, extra = {}) => ({ id, display_name: id, gender, is_deceased: false, ...extra });
const parentEdge = (parentId, childId, qualifier = 'biological') =>
  ({ type: 'parent', from_person: parentId, to_person: childId, qualifier, partner_status: null });
const partnerEdge = (a, b, status = 'current') =>
  ({ type: 'partner', from_person: a, to_person: b, qualifier: 'biological', partner_status: status });

function reasonOf(idx, id) {
  const r = idx.inclusionReasonById.get(id);
  return r ? { tier: r.tier, route: r.route, sourceId: r.sourceId } : null;
}

// ── 1. viewer alone ──────────────────────────────────────────────────────

test('viewer alone: primary contains only the viewer, everyone else outside', () => {
  const g = buildGraph([person('v'), person('stranger')], []);
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.deepEqual([...idx.primaryIds], ['v']);
  assert.ok(idx.outsideIds.has('stranger'));
  assert.equal(idx.explanationById.get('v'), 'You');
});

// ── 2. current partner with separate ancestry ────────────────────────────

test('current partner with separate ancestry: partner is an anchor, their own ancestors become primary/directLine', () => {
  const g = buildGraph(
    [person('v'), person('p'), person('pMum', 'female'), person('pDad'), person('stranger')],
    [partnerEdge('v', 'p', 'current'), parentEdge('pMum', 'p'), parentEdge('pDad', 'p')],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.ok(idx.anchorIds.has('p'));
  assert.equal(reasonOf(idx, 'pMum').tier, 'primary');
  assert.equal(reasonOf(idx, 'pMum').route, 'ancestor');
  assert.equal(reasonOf(idx, 'pMum').sourceId, 'p');
  assert.ok(idx.insightCohortIds.directLine.has('pMum'));
  assert.ok(idx.outsideIds.has('stranger'));
  assert.equal(idx.explanationById.get('pMum'), "Your partner's mother.");
});

// ── 3. four current partners + eight-anchor stress case (fixture-driven) ─

test('four current partners: all become anchors; a connected hub’s ancestors are primary', () => {
  const { tree, meta } = generateFamilyFixture({ size: 500, seed: 3 });
  const g = buildGraph(tree.people, tree.relationships);
  const hub = meta.connectedFourPartnerAnchorId;
  assert.ok(hub, 'sanity: fixture guarantees a connected 4-partner hub at this size');
  const idx = computePerspectiveIndex(g, { viewerId: hub, perimeterLevel: 1 });
  const currentPartners = g.partners(hub).filter((p) => p.status === 'current');
  assert.ok(currentPartners.length >= 4, 'sanity: hub really has >=4 current partners');
  for (const p of currentPartners) assert.ok(idx.anchorIds.has(p.id));
});

test('eight-anchor stress case: all eight current partners become anchors, no crash, reasonable time', () => {
  const { tree, meta } = generateFamilyFixture({ size: 1100, seed: 5 });
  const g = buildGraph(tree.people, tree.relationships);
  const hub = meta.connectedEightPartnerAnchorId;
  assert.ok(hub, 'sanity: fixture guarantees a connected 8-partner hub at this size');
  const t0 = performance.now();
  const idx = computePerspectiveIndex(g, { viewerId: hub, perimeterLevel: 2 });
  const elapsed = performance.now() - t0;
  const currentPartners = g.partners(hub).filter((p) => p.status === 'current');
  assert.ok(currentPartners.length >= 8);
  for (const p of currentPartners) assert.ok(idx.anchorIds.has(p.id));
  // Reported, not hard-gated to the same budget as the 4-anchor standard
  // case (docs §7: "reported separately for an eight-anchor stress case").
  console.log(`      (8-anchor stress case @ 1,100 people: ${elapsed.toFixed(2)}ms)`);
});

// ── 4/5. former partner with / without shared children ───────────────────

test('former partner WITH a shared child: included via family halo (shared-child rule)', () => {
  const g = buildGraph(
    [person('v'), person('ex'), person('kid')],
    [partnerEdge('v', 'ex', 'former'), parentEdge('v', 'kid'), parentEdge('ex', 'kid')],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.ok(!idx.anchorIds.has('ex'), 'a former partner is never an anchor');
  // Note: the shared child is itself primary (viewer's own descendant), so
  // "ex" legitimately qualifies for family halo via TWO routes at once —
  // as the child's other parent, and as viewer's former-partner-with-a-
  // shared-child — a genuine tie the stable id tie-break resolves
  // deterministically; either is a correct explanation, so only the tier
  // (not the specific winning route) is asserted here.
  assert.equal(reasonOf(idx, 'ex').tier, 'familyHalo');
});

test('former partner WITHOUT any shared child: not included at all (outside)', () => {
  const g = buildGraph(
    [person('v'), person('ex')],
    [partnerEdge('v', 'ex', 'former')],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.ok(!idx.perimeterIds.has('ex'));
  assert.ok(idx.outsideIds.has('ex'));
});

// ── 6. biological child ──────────────────────────────────────────────────

test('biological child: primary, direct descendant, distance 1', () => {
  const g = buildGraph([person('v'), person('kid')], [parentEdge('v', 'kid')]);
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  const r = reasonOf(idx, 'kid');
  assert.equal(r.tier, 'primary');
  assert.equal(r.route, 'descendant');
  assert.ok(idx.insightCohortIds.directLine.has('kid'));
});

// ── 7. adopted child and adopted descendants ─────────────────────────────

test('adopted child and their own descendant: both primary — adoptive propagates ancestry like biological', () => {
  const g = buildGraph(
    [person('v'), person('adoptedKid'), person('adoptedGrandkid')],
    [parentEdge('v', 'adoptedKid', 'adoptive'), parentEdge('adoptedKid', 'adoptedGrandkid', 'biological')],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.equal(reasonOf(idx, 'adoptedKid').tier, 'primary');
  assert.equal(reasonOf(idx, 'adoptedGrandkid').tier, 'primary');
  assert.ok(idx.insightCohortIds.directLine.has('adoptedGrandkid'));
});

// ── 8. stepchild and stepchild's other parent ────────────────────────────

test("stepchild (via a current-partner anchor's own bio child) is primary; the child's other bio parent is halo", () => {
  const g = buildGraph(
    [person('v'), person('partner'), person('stepkid'), person('otherParent')],
    [
      partnerEdge('v', 'partner', 'current'),
      parentEdge('partner', 'stepkid', 'biological'),
      parentEdge('otherParent', 'stepkid', 'biological'),
      parentEdge('v', 'stepkid', 'step'), // viewer's own recorded step-parent edge
    ],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  // The step edge from viewer never propagates ancestry (excluded from the
  // bio/adoptive-only ancestor/descendant walk) — but the child still ends
  // up primary via the STRONGER route: partner is a current-partner anchor,
  // and this is partner's own biological child.
  const r = reasonOf(idx, 'stepkid');
  assert.equal(r.tier, 'primary');
  assert.equal(r.route, 'descendant');
  assert.equal(r.sourceId, 'partner');
  // The stepchild's other, unrelated bio parent is swept in as family halo
  // of the now-primary stepchild.
  const r2 = reasonOf(idx, 'otherParent');
  assert.equal(r2.tier, 'familyHalo');
  assert.equal(r2.route, 'parent');
  assert.equal(r2.sourceId, 'stepkid');
});

test('a pure step-parent relationship (no partner-anchor route at all) still gets the child into the family halo, never primary', () => {
  const g = buildGraph(
    [person('v'), person('stepkid')],
    [parentEdge('v', 'stepkid', 'step')],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  const r = reasonOf(idx, 'stepkid');
  assert.equal(r.tier, 'familyHalo');
  assert.equal(r.route, 'child');
});

// ── 9. full / half / step siblings ────────────────────────────────────────

test('full sibling: swept into PRIMARY via the collateral (degree-0) walk, since a shared bio parent exists', () => {
  const g = buildGraph(
    [person('v'), person('sib'), person('mum'), person('dad')],
    [parentEdge('mum', 'v'), parentEdge('dad', 'v'), parentEdge('mum', 'sib'), parentEdge('dad', 'sib')],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  const r = reasonOf(idx, 'sib');
  assert.equal(r.tier, 'primary');
  assert.equal(r.route, 'cousin');
  assert.equal(idx.inclusionReasonById.get('sib').degree, 0);
});

test('half sibling: also primary via the same degree-0 collateral route (one shared bio parent is enough)', () => {
  const g = buildGraph(
    [person('v'), person('halfSib'), person('mum'), person('dadA'), person('dadB')],
    [parentEdge('mum', 'v'), parentEdge('dadA', 'v'), parentEdge('mum', 'halfSib'), parentEdge('dadB', 'halfSib')],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.equal(reasonOf(idx, 'halfSib').tier, 'primary');
});

test("step sibling (no shared bio/adoptive parent at all): NOT reachable via the collateral walk — family halo only, exactly where step propagation stops", () => {
  const g = buildGraph(
    [person('v'), person('stepSib'), person('mum'), person('stepdad')],
    [
      parentEdge('mum', 'v'), parentEdge('stepdad', 'v', 'step'),
      parentEdge('stepdad', 'stepSib'), // stepdad's own biological child from elsewhere
    ],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  const r = reasonOf(idx, 'stepSib');
  assert.equal(r.tier, 'familyHalo');
  assert.equal(r.route, 'sibling');
});

test('sibling (removal 0) carries side "same"; aunt/uncle (removal 1, older generation) carries side "older"', () => {
  // v's parent (mum) has a sibling (auntP) — a real aunt, degree 0 removal 1
  // (shares grandparent gp: mum is 1 step from gp, auntP is 1 step from gp
  // too, but from v's own perspective upA=2 (v→mum→gp), downB=1 (gp→auntP),
  // so auntP sits one generation ABOVE v — "older").
  const g = buildGraph(
    [person('v'), person('sib'), person('mum'), person('dad'), person('gp'), person('auntP')],
    [
      parentEdge('mum', 'v'), parentEdge('dad', 'v'),
      parentEdge('mum', 'sib'), parentEdge('dad', 'sib'),
      parentEdge('gp', 'mum'), parentEdge('gp', 'auntP'),
    ],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  const sibR = idx.inclusionReasonById.get('sib');
  assert.equal(sibR.degree, 0);
  assert.equal(sibR.removal, 0);
  assert.equal(sibR.side, 'same');

  const auntR = idx.inclusionReasonById.get('auntP');
  assert.equal(auntR.degree, 0);
  assert.equal(auntR.removal, 1);
  assert.equal(auntR.side, 'older');
});

test('niece/nephew (removal 1, younger generation) carries side "younger" — the mirror image of an aunt/uncle', () => {
  // v's sibling (sib) has a child (kid) — v's real nephew/niece. Shared
  // ancestor is v's own parent (mum): upA=1 (v→mum), downB=2 (mum→sib→kid),
  // so kid sits one generation BELOW v — "younger".
  const g = buildGraph(
    [person('v'), person('sib'), person('mum'), person('kid')],
    [parentEdge('mum', 'v'), parentEdge('mum', 'sib'), parentEdge('sib', 'kid')],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  const kidR = idx.inclusionReasonById.get('kid');
  assert.equal(kidR.degree, 0);
  assert.equal(kidR.removal, 1);
  assert.equal(kidR.side, 'younger');
});

test('a direct parent/grandparent/child is never re-labeled as a spurious "cousin" via the collateral walk, even when they also have other children (a real bug: the collateral walk previously found candidates that land back on the anchor\'s own direct line — e.g. walking up to a grandparent and back down passes straight through the anchor\'s own parent — and a low cousin degree/removal beat the correct, larger ancestor/descendant distance in canonical resolution, silently mislabeling a parent or child as a "cousin")', () => {
  // v's parent (dad) has a sibling (auntP) — dad is reachable from v's own
  // grandparent (gp) via the exact same up-then-down collateral path that
  // correctly finds auntP as v's aunt, so dad must be excluded from that
  // walk (he already has his own correct 'ancestor' candidate). Likewise
  // v's own child (kid) is reachable from gp by walking further down past
  // v, and must stay 'descendant', not 'cousin'.
  const g = buildGraph(
    [person('v'), person('dad'), person('auntP'), person('gp'), person('kid')],
    [
      parentEdge('gp', 'dad'), parentEdge('gp', 'auntP'),
      parentEdge('dad', 'v'), parentEdge('v', 'kid'),
    ],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.equal(reasonOf(idx, 'dad').route, 'ancestor');
  assert.equal(idx.inclusionReasonById.get('dad').closeness[0], 1);
  assert.equal(reasonOf(idx, 'gp').route, 'ancestor');
  assert.equal(idx.inclusionReasonById.get('gp').closeness[0], 2);
  assert.equal(reasonOf(idx, 'kid').route, 'descendant');
  // auntP is a genuine collateral relative (v's aunt) — still correctly
  // found via the walk this fix narrows, not accidentally excluded too.
  assert.equal(reasonOf(idx, 'auntP').route, 'cousin');
  assert.equal(idx.inclusionReasonById.get('auntP').degree, 0);
});

// ── 10/11. cousins + removals ─────────────────────────────────────────────

function cousinFixture() {
  // v and cousin1 share grandparent gp via v's parent dad and cousin1's
  // parent auntP (dad's sibling). cousin1 has their own child cousin1kid
  // (a 1st-cousin-once-removed of v).
  return buildGraph(
    [person('v'), person('dad'), person('auntP'), person('gp'), person('gp2'),
      person('cousin1'), person('cousin1kid')],
    [
      parentEdge('gp', 'dad'), parentEdge('gp2', 'dad'),
      parentEdge('gp', 'auntP'), parentEdge('gp2', 'auntP'),
      parentEdge('dad', 'v'),
      parentEdge('auntP', 'cousin1'),
      parentEdge('cousin1', 'cousin1kid'),
    ],
  );
}

test('1st cousin: primary at Close family (degree 1), NOT included at all if perimeter were narrower than 1 cousin (sanity: everyone level always includes)', () => {
  const g = cousinFixture();
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  const r = reasonOf(idx, 'cousin1');
  assert.equal(r.tier, 'primary');
  assert.equal(r.route, 'cousin');
  assert.equal(idx.inclusionReasonById.get('cousin1').degree, 1);
  assert.equal(idx.inclusionReasonById.get('cousin1').removal, 0);
});

test('1st cousin once removed (cousin’s child): degree 1, removal 1 — included at Close family ("1st cousins at any removal")', () => {
  const g = cousinFixture();
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  const r = idx.inclusionReasonById.get('cousin1kid');
  assert.equal(r.tier, 'primary');
  assert.equal(r.degree, 1);
  assert.equal(r.removal, 1);
});

test('3rd cousin: excluded at Close family; pulled in at Extended (via a closer relative’s own halo) and at Wider (directly)', () => {
  // v and cousin3 share great-great-grandparent anc4 (4 generations each
  // side — a true 3rd cousin, degree 3). cousin3's own PARENT (r1) is
  // necessarily one generation closer to anc4 than cousin3 — a genuine
  // "2nd cousin once removed" of v (degree 2). This is exactly why a
  // "2nd cousin excluded at Close family" test can't be built with a fully
  // connected genealogy: EVERY 2nd cousin's parent is, by construction, a
  // 1st-cousin-once-removed of v (degree 1) — included at Close family
  // ("1st cousins at any removal") and therefore already PRIMARY there,
  // which means the 2nd cousin gets pulled in anyway via that parent's own,
  // ordinary, unconditional family halo (§3.4's "child of a primary-
  // perimeter person" bullet has no cousin-degree exception). The same
  // one-generation halo spillover applies here too: at Extended family
  // (degree 2), r1 (degree 2) becomes primary, and cousin3 rides in via
  // r1's halo — even though cousin3's OWN degree (3) exceeds Extended's
  // own threshold. Only at Close family, where r1 (degree 2) itself is
  // NOT primary, does cousin3 genuinely stay outside.
  const g = buildGraph(
    [person('v'), person('l1'), person('l2'), person('l3'), person('anc4'),
      person('r3'), person('r2'), person('r1'), person('cousin3')],
    [
      parentEdge('anc4', 'l3'), parentEdge('anc4', 'r3'),
      parentEdge('l3', 'l2'), parentEdge('l2', 'l1'), parentEdge('l1', 'v'),
      parentEdge('r3', 'r2'), parentEdge('r2', 'r1'), parentEdge('r1', 'cousin3'),
    ],
  );
  const close = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  // r1 (cousin3's own parent) is NOT primary at Close family — it only
  // shows up (if at all) via a grandparent's halo, and halo never recurses
  // (§3.4), so it can't hand cousin3 a backdoor of its own.
  assert.notEqual(reasonOf(close, 'r1')?.tier, 'primary', 'sanity: cousin3’s own parent is not primary at Close family');
  assert.ok(!close.perimeterIds.has('cousin3'), '3rd cousin must be outside Close family');

  const extended = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 2 });
  assert.equal(reasonOf(extended, 'r1').tier, 'primary');
  assert.equal(extended.inclusionReasonById.get('r1').degree, 2);
  assert.equal(reasonOf(extended, 'cousin3').tier, 'familyHalo', 'pulled in via r1’s halo, not directly');

  const wider = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 3 });
  const r = reasonOf(wider, 'cousin3');
  assert.equal(r.tier, 'primary');
  assert.equal(wider.inclusionReasonById.get('cousin3').degree, 3);
});

// ── 12/13. cousin's partner, and cousin's partner's parents/siblings/children ─

test("cousin's partner: family halo (partner rule); cousin's partner's parent/sibling/child: partner context ring", () => {
  const g = cousinFixture();
  g.people.push(person('cousin1Partner'), person('cpParent'), person('cpSibling'), person('cpChild'));
  const g2 = buildGraph(
    [...g.people],
    [
      parentEdge('gp', 'dad'), parentEdge('gp2', 'dad'),
      parentEdge('gp', 'auntP'), parentEdge('gp2', 'auntP'),
      parentEdge('dad', 'v'),
      parentEdge('auntP', 'cousin1'),
      parentEdge('cousin1', 'cousin1kid'),
      partnerEdge('cousin1', 'cousin1Partner', 'current'),
      parentEdge('cpParent', 'cousin1Partner'),
      parentEdge('cpParent', 'cpSibling'),
      parentEdge('cousin1Partner', 'cpChild'),
    ],
  );
  const idx = computePerspectiveIndex(g2, { viewerId: 'v', perimeterLevel: 1 });
  const rPartner = reasonOf(idx, 'cousin1Partner');
  assert.equal(rPartner.tier, 'familyHalo');
  assert.equal(rPartner.route, 'partner');
  assert.equal(rPartner.sourceId, 'cousin1');

  for (const [id, route] of [['cpParent', 'parent'], ['cpSibling', 'sibling'], ['cpChild', 'child']]) {
    const r = reasonOf(idx, id);
    assert.equal(r.tier, 'partnerContext', `${id} should be partnerContext`);
    assert.equal(r.route, route);
    assert.equal(r.sourceId, 'cousin1Partner');
  }
});

// ── 14. multiple marriages ────────────────────────────────────────────────

test('multiple marriages: a former partner with a shared child AND a current partner are both in the family halo', () => {
  const g = buildGraph(
    [person('p'), person('exWife'), person('kidFromEx'), person('currentWife')],
    [
      partnerEdge('p', 'exWife', 'former'), parentEdge('p', 'kidFromEx'), parentEdge('exWife', 'kidFromEx'),
      partnerEdge('p', 'currentWife', 'current'),
    ],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'p', perimeterLevel: 1 });
  assert.equal(reasonOf(idx, 'exWife').tier, 'familyHalo');
  // currentWife is both an ANCHOR (current partner of viewer) and thus primary.
  assert.ok(idx.anchorIds.has('currentWife'));
  assert.equal(reasonOf(idx, 'currentWife').tier, 'primary');
});

// ── 15. two paths to one person / pedigree collapse ──────────────────────

test('pedigree collapse: a person reachable by two ancestry paths still gets exactly one canonical reason, no crash', () => {
  const { tree, meta } = generateFamilyFixture({ size: 100, seed: 7 });
  const g = buildGraph(tree.people, tree.relationships);
  assert.ok(meta.pedigreeCollapseChildId, 'sanity: fixture guarantees a pedigree-collapse child');
  const idx = computePerspectiveIndex(g, { viewerId: tree.myPersonId, perimeterLevel: 3 });
  // Whatever the classification, it must be singular and well-formed.
  const id = meta.pedigreeCollapseChildId;
  if (idx.perimeterIds.has(id)) {
    const r = idx.inclusionReasonById.get(id);
    assert.ok(r.tier);
    assert.ok(idx.explanationById.get(id));
  }
});

// ── 16. same person qualifying through viewer AND partner ────────────────

test('same person reachable via two different anchors: canonical reason is deterministic (lexicographically-smallest anchor id wins a tie)', () => {
  // Both v and partner 'z' are 1st cousins of the SAME person via entirely
  // separate ancestries — a tie in tier (primary) and closeness ([1,0]),
  // broken only by comparing anchor ids 'v' vs 'z'.
  const g = buildGraph(
    [
      person('v'), person('z'), person('shared'),
      person('vDad'), person('vGp'), person('vGp2'), person('vAunt'),
      person('zDad'), person('zGp'), person('zGp2'), person('zAunt'),
    ],
    [
      partnerEdge('v', 'z', 'current'),
      parentEdge('vGp', 'vDad'), parentEdge('vGp2', 'vDad'), parentEdge('vDad', 'v'),
      parentEdge('vGp', 'vAunt'), parentEdge('vGp2', 'vAunt'), parentEdge('vAunt', 'shared'),
      parentEdge('zGp', 'zDad'), parentEdge('zGp2', 'zDad'), parentEdge('zDad', 'z'),
      parentEdge('zGp', 'zAunt'), parentEdge('zGp2', 'zAunt'), parentEdge('zAunt', 'shared'),
    ],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  const r = idx.inclusionReasonById.get('shared');
  assert.equal(r.tier, 'primary');
  assert.equal(r.sourceId, 'v' < 'z' ? 'v' : 'z');
});

// ── 17. missing qualifier ─────────────────────────────────────────────────

test('missing qualifier on a parent edge defaults to biological-equivalent (propagates ancestry)', () => {
  const g = buildGraph([person('v'), person('kid')], [{ type: 'parent', from_person: 'v', to_person: 'kid', qualifier: undefined, partner_status: null }]);
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.equal(reasonOf(idx, 'kid').tier, 'primary');
  assert.equal(reasonOf(idx, 'kid').route, 'descendant');
});

// ── 18. missing current/former partner status ─────────────────────────────

test('missing partner status is never guessed as current — not an anchor, halo only with real evidence', () => {
  const g = buildGraph(
    [person('v'), person('mystery')],
    [{ type: 'partner', from_person: 'v', to_person: 'mystery', qualifier: 'biological', partner_status: undefined }],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.ok(!idx.anchorIds.has('mystery'));
  assert.ok(!idx.perimeterIds.has('mystery'), 'no shared child and no current status — must not be silently included');
});

// ── 19. disconnected people ────────────────────────────────────────────────

test('disconnected people (zero relationships) end up outside, with no boundary edge referencing them', () => {
  const g = buildGraph([person('v'), person('kid'), person('ghost')], [parentEdge('v', 'kid')]);
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.ok(idx.outsideIds.has('ghost'));
  assert.ok(!idx.boundaryEdges.some((e) => e.fromId === 'ghost' || e.toId === 'ghost'));
});

// ── 20. corrupt cycle ─────────────────────────────────────────────────────

test('corrupt cycle: terminates quickly and produces a well-formed result, never hangs', () => {
  const { tree } = generateCorruptCycleFixture(1);
  const g = buildGraph(tree.people, tree.relationships);
  const t0 = performance.now();
  const idx = computePerspectiveIndex(g, { viewerId: tree.people[0].id, perimeterLevel: 'everyone' });
  const elapsed = performance.now() - t0;
  assert.ok(idx.perimeterIds.size > 0);
  assert.ok(elapsed < 500, `must terminate quickly even on a corrupt cycle (took ${elapsed}ms)`);
});

// ── Everyone level ─────────────────────────────────────────────────────────

test("perimeterLevel 'everyone' marks every person primary and skips cousin calculation", () => {
  const g = cousinFixture();
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 'everyone' });
  for (const p of g.people) assert.ok(idx.primaryIds.has(p.id));
  assert.equal(idx.outsideIds.size, 0);
});

// Real bug found while building PerimeterPreview.jsx: the 'everyone' branch
// marks every person primary with a SELF-referential sourceId (`p.id`,
// deliberately — "skip cousin calculation entirely" is the whole point,
// for performance). Before this fix, explainInclusion's `id === anchorId`
// check was satisfied by that self-reference for literally every person,
// so every single row read "Your partner." regardless of the real
// relationship — nothing before PerimeterPreview ever displayed this text
// for the 'everyone' level, so it went unnoticed until now.
test("explanationById at perimeterLevel 'everyone': every non-viewer person reads a neutral, correct phrase — never the self-referential 'Your partner.' bug", () => {
  const g = cousinFixture();
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 'everyone' });
  for (const p of g.people) {
    if (p.id === 'v') continue;
    const text = idx.explanationById.get(p.id);
    assert.equal(text, 'In your family tree.', `${p.id} got "${text}" instead of the neutral 'everyone' explanation`);
  }
});

// ── Bloodline-only projection (§3.7) ───────────────────────────────────────

test('Bloodline-only narrows the current perimeter to biological/adoptive lineage, never adds anyone new', () => {
  const g = buildGraph(
    [person('v'), person('partner'), person('kid'), person('partnerParent')],
    [
      partnerEdge('v', 'partner', 'current'),
      parentEdge('v', 'kid'), parentEdge('partner', 'kid'),
      parentEdge('partnerParent', 'partner'),
    ],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1, bloodlineOnly: true });
  // partner is included in the ordinary perimeter (anchor) but is not
  // v's own blood/adoptive relative — Bloodline-only should drop them.
  assert.ok(idx.perimeterIds.has('partner'));
  assert.ok(!idx.bloodlineIds.has('partner'), 'a partner is not blood/adoptive lineage');
  assert.ok(idx.bloodlineIds.has('kid'), 'a shared biological child stays');
  for (const id of idx.bloodlineIds) assert.ok(idx.perimeterIds.has(id), 'bloodlineIds must never add anyone new');
});

// ── Temporary reveal (§3.8) ─────────────────────────────────────────────────

test('temporary reveal adds the minimum path + local family unit for an outside target, without changing the saved perimeter', () => {
  // target is v's 3rd cousin (shared great-great-grandparent anc4, degree 3)
  // — genuinely outside a Close-family (degree-1) perimeter, including via
  // the one-generation family-halo spillover a 2nd cousin's parent would
  // otherwise trigger (see the dedicated 3rd-cousin test above for why a
  // 2nd cousin can't be used to demonstrate genuine exclusion).
  const g = buildGraph(
    [person('v'), person('l1'), person('l2'), person('l3'), person('anc4'),
      person('r3'), person('r2'), person('r1'), person('target'), person('targetKid')],
    [
      parentEdge('anc4', 'l3'), parentEdge('anc4', 'r3'),
      parentEdge('l3', 'l2'), parentEdge('l2', 'l1'), parentEdge('l1', 'v'),
      parentEdge('r3', 'r2'), parentEdge('r2', 'r1'), parentEdge('r1', 'target'), parentEdge('target', 'targetKid'),
    ],
  );
  const base = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.ok(!base.perimeterIds.has('target'), 'sanity: target is outside the saved Close-family perimeter');
  const withReveal = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1, temporaryRevealIds: ['target'] });
  assert.ok(withReveal.temporaryRevealPresentationIds.has('target'));
  assert.ok(withReveal.temporaryRevealPresentationIds.has('targetKid'), "target's local family unit is included too");
  assert.ok(withReveal.minimumRevealPathById.get('target').includes('v'));
  assert.ok(withReveal.minimumRevealPathById.get('target').includes('target'));
  // The SAVED perimeter is untouched by a temporary reveal.
  assert.deepEqual([...withReveal.perimeterIds].sort(), [...base.perimeterIds].sort());
  assert.equal(withReveal.explanationById.get('target'), 'Temporarily shown from Search.');
});

// ── Insight cohorts (§4.4) ──────────────────────────────────────────────────

test('insight cohorts: personal = primary+halo+context, complete = every person regardless of viewer', () => {
  const g = buildGraph(
    [person('v'), person('partner'), person('kid'), person('partnerParent'), person('stranger')],
    [
      partnerEdge('v', 'partner', 'current'),
      parentEdge('v', 'kid'), parentEdge('partner', 'kid'),
      parentEdge('partnerParent', 'partner'),
    ],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.equal(idx.insightCohortIds.complete.size, g.people.length);
  assert.ok(idx.insightCohortIds.complete.has('stranger'));
  assert.ok(!idx.insightCohortIds.personal.has('stranger'));
  for (const id of idx.insightCohortIds.personal) {
    assert.ok(idx.primaryIds.has(id) || idx.familyHaloIds.has(id) || idx.partnerContextIds.has(id));
  }
});

// A real user report: the tree canvas/Perimeter Preview (perimeterIds =
// primary+halo+context) reported a different total than the Insights/Home
// header (personal, which used to be primary+halo only) for the SAME
// perimeter level. The gap was exactly the partner-context people. `personal`
// now includes them so both surfaces agree — pinned here with a fixture
// where a person is reachable ONLY via the partner-context ring (a halo
// sibling's partner's own parent — not an ancestor of any primary anchor,
// so it can't land in `primaryIds` the way `partnerParent` does above).
test('insight cohorts: a genuine partner-context-only person is now included in personal, and matches perimeterIds', () => {
  const g = buildGraph(
    [
      person('v'), person('sib'), person('sibPartner'), person('sibPartnerParent'), person('parent'),
      person('stranger'),
    ],
    [
      parentEdge('parent', 'v'), parentEdge('parent', 'sib'),
      partnerEdge('sib', 'sibPartner', 'current'),
      parentEdge('sibPartnerParent', 'sibPartner'),
    ],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  // Sanity: this person is reachable ONLY through the partner-context ring.
  assert.ok(idx.partnerContextIds.has('sibPartnerParent'));
  assert.ok(!idx.primaryIds.has('sibPartnerParent'));
  assert.ok(!idx.familyHaloIds.has('sibPartnerParent'));
  // The actual fix: personal now includes them, matching perimeterIds.
  assert.ok(idx.insightCohortIds.personal.has('sibPartnerParent'));
  assert.ok(idx.perimeterIds.has('sibPartnerParent'));
  assert.deepEqual([...idx.insightCohortIds.personal].sort(), [...idx.perimeterIds].sort());
  assert.ok(!idx.insightCohortIds.personal.has('stranger'));

  // The lighter computeInsightCohorts sibling must agree.
  const cohorts = computeInsightCohorts(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.ok(cohorts.personal.has('sibPartnerParent'));
  assert.deepEqual([...cohorts.personal].sort(), [...idx.insightCohortIds.personal].sort());

  // `context` still reports the same partner-context ids on their own —
  // now a subset of `personal`, not a disjoint complement.
  assert.ok(idx.insightCohortIds.context.has('sibPartnerParent'));
  for (const id of idx.insightCohortIds.context) assert.ok(idx.insightCohortIds.personal.has(id));
});

// ── Determinism / order independence (exit criterion) ─────────────────────

test('result is deterministic regardless of the order people/relationships were supplied in', () => {
  const g1 = cousinFixture();
  const shuffledPeople = [...g1.people].reverse();
  const shuffledRels = [...g1.relationships].reverse();
  const g2 = buildGraph(shuffledPeople, shuffledRels);

  const idx1 = computePerspectiveIndex(g1, { viewerId: 'v', perimeterLevel: 2 });
  const idx2 = computePerspectiveIndex(g2, { viewerId: 'v', perimeterLevel: 2 });

  assert.deepEqual([...idx1.perimeterIds].sort(), [...idx2.perimeterIds].sort());
  for (const id of idx1.perimeterIds) {
    const r1 = reasonOf(idx1, id);
    const r2 = reasonOf(idx2, id);
    assert.deepEqual(r1, r2, `reason for ${id} must be identical regardless of input order`);
  }
});

// ── No shared data mutation (exit criterion) ───────────────────────────────

test('computePerspectiveIndex never mutates the graph or its people/relationships', () => {
  const g = cousinFixture();
  const peopleSnapshot = JSON.stringify(g.people);
  const relsSnapshot = JSON.stringify(g.relationships);
  computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 2, bloodlineOnly: true, temporaryRevealIds: ['cousin1kid'] });
  assert.equal(JSON.stringify(g.people), peopleSnapshot);
  assert.equal(JSON.stringify(g.relationships), relsSnapshot);
});

// ── Unknown / missing viewer ────────────────────────────────────────────────

test('unknown viewerId returns a safe, empty index rather than throwing', () => {
  const g = buildGraph([person('a'), person('b')], []);
  const idx = computePerspectiveIndex(g, { viewerId: 'nope', perimeterLevel: 1 });
  assert.equal(idx.perimeterIds.size, 0);
  assert.equal(idx.outsideIds.size, 2);
});

// ── No arbitrary generation cap (Codex review, PR #87, P1 #1) ─────────────

test('a direct ancestor more than 8 generations up is still primary — no silent truncation', () => {
  // 10 generations: anc(10) -> ... -> v, all biological.
  const N = 10;
  const ids = Array.from({ length: N + 1 }, (_, i) => `g${i}`); // g0 = eldest ancestor, gN = v
  const people = ids.map((id) => person(id));
  const rels = [];
  for (let i = 0; i < N; i++) rels.push(parentEdge(ids[i], ids[i + 1]));
  const g = buildGraph(people, rels);
  const idx = computePerspectiveIndex(g, { viewerId: 'g10', perimeterLevel: 1 });
  const r = reasonOf(idx, 'g0');
  assert.equal(r.tier, 'primary');
  assert.equal(r.route, 'ancestor');
  assert.ok(idx.insightCohortIds.directLine.has('g0'), 'a 10-generations-up ancestor must still be directLine, not truncated at 8');
});

test('a 1st cousin at a large removal (well beyond 8 generations of descent) is still included — "any removal" has no cap', () => {
  // v's parent's SIBLING (v's aunt/uncle) has a line of descendants 9
  // generations deep — the 9th-generation descendant is still v's 1st
  // cousin (degree 1), just heavily removed. Before the fix, the "generous"
  // descent from a close ancestor (upA <= maxDegree+1) was still silently
  // capped at the default maxDepth=8, truncating exactly this case.
  const g = buildGraph(
    [person('v'), person('dad'), person('gp'), person('gp2'), person('auntFar'),
      ...Array.from({ length: 9 }, (_, i) => person(`desc${i}`))],
    [
      parentEdge('gp', 'dad'), parentEdge('gp2', 'dad'), parentEdge('dad', 'v'),
      parentEdge('gp', 'auntFar'), parentEdge('gp2', 'auntFar'),
      parentEdge('auntFar', 'desc0'),
      ...Array.from({ length: 8 }, (_, i) => parentEdge(`desc${i}`, `desc${i + 1}`)),
    ],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  const r = idx.inclusionReasonById.get('desc8'); // 9 generations down from auntFar
  assert.ok(r, 'a heavily-removed 1st cousin must not be truncated');
  assert.equal(r.tier, 'primary');
  assert.equal(r.degree, 1);
  assert.equal(r.removal, 8);
});

// ── Retained multi-route reasons (Codex review, PR #87, P1 #2) ────────────

test('a person qualifying through two distinct routes retains BOTH in inclusionReasonsById, with the canonical one first and stable', () => {
  // Same shape as the "former partner with a shared child" case above: the
  // shared child makes "ex" qualify both as the child's own parent (halo,
  // via the child) AND as viewer's former-partner-with-shared-child (halo,
  // via viewer) — a genuine tie, resolved deterministically.
  const g = buildGraph(
    [person('v'), person('ex'), person('kid')],
    [partnerEdge('v', 'ex', 'former'), parentEdge('v', 'kid'), parentEdge('ex', 'kid')],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  const all = idx.inclusionReasonsById.get('ex');
  assert.ok(Array.isArray(all) && all.length >= 2, 'both qualifying routes must be retained for diagnostics');
  const routes = all.map((r) => `${r.tier}/${r.route}/${r.sourceId}`);
  assert.ok(routes.includes('familyHalo/parent/kid'));
  assert.ok(routes.includes('familyHalo/partner/v'));
  // The canonical single-reason map must always agree with index 0 of the
  // full retained list — that's the whole point of resolving both from the
  // same sort order.
  assert.deepEqual(idx.inclusionReasonById.get('ex'), all[0]);
});

test('a person already primary who also sits on a temporary-reveal path retains BOTH reasons, without the weaker one ever winning canonically', () => {
  // Same 3rd-cousin fixture as the temporary-reveal test above: l1 (v's own
  // parent) is already primary, AND sits on the minimum reveal path to the
  // outside 3rd-cousin target — so revealing target should add a SECOND,
  // temporaryReveal-tier candidate for l1 on top of its real one.
  const g = buildGraph(
    [person('v'), person('l1'), person('l2'), person('l3'), person('anc4'),
      person('r3'), person('r2'), person('r1'), person('target'), person('targetKid')],
    [
      parentEdge('anc4', 'l3'), parentEdge('anc4', 'r3'),
      parentEdge('l3', 'l2'), parentEdge('l2', 'l1'), parentEdge('l1', 'v'),
      parentEdge('r3', 'r2'), parentEdge('r2', 'r1'), parentEdge('r1', 'target'), parentEdge('target', 'targetKid'),
    ],
  );
  const idx = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1, temporaryRevealIds: ['target'] });
  assert.equal(idx.inclusionReasonById.get('l1').tier, 'primary', 'the stronger, real reason must still win canonically');
  const all = idx.inclusionReasonsById.get('l1');
  assert.ok(all.length >= 2, 'both the real reason and the reveal-path reason must be retained');
  assert.ok(all.some((r) => r.tier === 'temporaryReveal'), 'the temporary-reveal route is still retained for diagnostics');
  assert.deepEqual(all[0], idx.inclusionReasonById.get('l1'), 'index 0 of the full list is always the canonical reason');
});

// ── 5,000-person performance budget (docs §7) ──────────────────────────────

test('5,000-person perimeter calculation meets the ≤300ms budget (standard 4-anchor case, measured on main thread as a worker-budget proxy)', () => {
  const { tree, meta } = generateFamilyFixture({ size: 5000, seed: 11 });
  const g = buildGraph(tree.people, tree.relationships);
  const hub = meta.connectedFourPartnerAnchorId || tree.myPersonId;
  const t0 = performance.now();
  const idx = computePerspectiveIndex(g, { viewerId: hub, perimeterLevel: 2 });
  const elapsed = performance.now() - t0;
  console.log(`      (5,000-person perimeter calc: ${elapsed.toFixed(2)}ms, perimeter size ${idx.perimeterIds.size})`);
  assert.ok(elapsed <= 300, `perimeter calculation took ${elapsed.toFixed(2)}ms, budget is 300ms`);
});

// ── computeInsightCohorts (Phase 6 §4.4/§6.9) — lightweight, always-on cohort
//    resolution for Insights/Home/Timeline, independent of whether a
//    perimeter narrower than Everyone is active. ──────────────────────────

test('computeInsightCohorts: no viewer (unknown/missing) → personal falls back to complete, not empty — insight modules must never silently report zero facts about a populated family', () => {
  const g = buildGraph([person('a'), person('b'), person('c')], []);
  const cohorts = computeInsightCohorts(g, {});
  assert.deepEqual(cohorts.personal, new Set(['a', 'b', 'c']));
  assert.deepEqual(cohorts.complete, new Set(['a', 'b', 'c']));
  assert.deepEqual(cohorts.context, new Set());
  assert.deepEqual(cohorts.directLine, new Set());
  assert.deepEqual(cohorts.temporaryReveal, new Set());
});

test('computeInsightCohorts: default perimeterLevel (everyone) makes personal === complete, matching computePerspectiveIndex\'s own tested "everyone" degenerate case', () => {
  const g = buildGraph(
    [person('v'), person('parent'), person('cousinOfDistantKind'), person('unrelatedStranger')],
    [parentEdge('parent', 'v')],
  );
  const cohorts = computeInsightCohorts(g, { viewerId: 'v' });
  assert.deepEqual(cohorts.personal, cohorts.complete);
  assert.equal(cohorts.personal.size, 4);
});

test('computeInsightCohorts: a real narrow perimeter level actually narrows personal (matches computePerspectiveIndex\'s own insightCohortIds for the same inputs)', () => {
  const g = buildGraph(
    [person('v'), person('parent'), person('grandparent'), person('greatGrandparent'), person('greatGreatUncle'),
      person('distantCousinParent'), person('distantCousin'), person('distantCousinKid')],
    [
      parentEdge('parent', 'v'), parentEdge('grandparent', 'parent'), parentEdge('greatGrandparent', 'grandparent'),
      parentEdge('greatGrandparent', 'greatGreatUncle'), parentEdge('greatGreatUncle', 'distantCousinParent'),
      parentEdge('distantCousinParent', 'distantCousin'), parentEdge('distantCousin', 'distantCousinKid'),
    ],
  );
  const cohorts = computeInsightCohorts(g, { viewerId: 'v', perimeterLevel: 1 });
  const full = computePerspectiveIndex(g, { viewerId: 'v', perimeterLevel: 1 });
  assert.deepEqual(cohorts.personal, full.insightCohortIds.personal);
  assert.deepEqual(cohorts.directLine, full.insightCohortIds.directLine);
  assert.deepEqual(cohorts.context, full.insightCohortIds.context);
  assert.notEqual(cohorts.personal.size, cohorts.complete.size, 'sanity check: this fixture must actually narrow, or the test proves nothing');
});

test('computeInsightCohorts: never computes boundaryEdges/relationshipById/explanationById — the whole point of the lighter sibling', () => {
  const g = buildGraph([person('v'), person('friend')], []);
  const cohorts = computeInsightCohorts(g, { viewerId: 'v' });
  assert.deepEqual(Object.keys(cohorts).sort(), ['complete', 'context', 'directLine', 'personal', 'temporaryReveal']);
});

// ── Report ──────────────────────────────────────────────────────────────────

console.log('\n── Perspective Index (Family Perimeter Phase 2) tests ─────────\n');
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}${r.error ? `\n      → ${r.error}` : ''}`);
}
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
