/*
 * Canopy — the growth choreography.
 *
 * A cross-fade says "here is a different picture." Growth says "this is the
 * same world, and it is unfolding." So a frame is never faded in: branches
 * draw outward from what is already on screen, and each person opens at the
 * tip of the branch that reached them.
 *
 * This module is PURE — given a planned frame it returns a schedule, in
 * milliseconds, for every bond and every node. Nothing here touches a canvas
 * or a clock, which means the choreography can be asserted in tests rather
 * than watched and hoped about.
 *
 *   scheduleGrowth(frame, opts) → { bonds: Map, nodes: Map, total }
 *
 * The rules it encodes:
 *   • the focus person is ALREADY there — they never grow and never move;
 *   • a bond animates its own LENGTH, 0 → 1, along its curve;
 *   • the person at the far tip stays at scale 0 until the branch is most of
 *     the way to them, then opens with a whisper of overshoot — a bud, not a
 *     pop. One clock drives both, so the arrival is genuinely CAUSED by the
 *     branch rather than merely simultaneous with it;
 *   • children unfurl eldest to youngest, one stagger step apart, so birth
 *     order stops being something you read off dates and becomes something
 *     you watch happen. That is the detail the whole view is built around;
 *   • the composition grows OUTWARD from the focus in both directions at
 *     once — descendants down, ancestors up — so the tree opens like a
 *     canopy rather than unrolling from one end.
 */

/** How long a single bond takes to draw itself. */
export const BOND_MS = 200;
/** How long a person takes to open once their branch arrives. */
export const BUD_MS = 230;
/** Gap between successive siblings/children opening — the birth-order beat. */
export const STAGGER_MS = 70;
/** Fraction of a bond's growth after which its person begins to open. */
export const ARRIVAL = 0.55;

/* Per-row base delays. Rows nearer the focus lead; the two directions run
 * concurrently rather than one after the other, which is what makes it read
 * as a canopy opening rather than a list being drawn. */
const ROW_DELAY = {
  0: 0,      // the focus row: partners and siblings
  1: 150,    // children
  '-1': 210, // parents
  2: 330,    // grandchildren
  '-2': 350, // grandparents
};

const rowDelay = (row) => ROW_DELAY[String(row)] ?? ROW_DELAY[row] ?? 400;

/**
 * @param {object} frame  a planned frame from planCanopy
 * @param {object} [opts] `{ reducedMotion }` collapses the whole score to a
 *        single short fade at the final positions — a designed alternative,
 *        not the animation switched off. Layout is identical either way,
 *        because layout never depended on the animation in the first place.
 */
export function scheduleGrowth(frame, opts = {}) {
  const bonds = new Map();
  const nodes = new Map();

  if (opts.reducedMotion) {
    for (const [id] of frame.nodes) {
      nodes.set(id, { delay: 0, dur: id === frame.focusId ? 0 : 120, fade: true });
    }
    frame.bonds.forEach((b, i) => bonds.set(bondKey(b, i), { delay: 0, dur: 120, fade: true }));
    return { bonds, nodes, total: 120, reduced: true };
  }

  // The focus is already present — the fixed point of the whole transition.
  nodes.set(frame.focusId, { delay: 0, dur: 0 });

  const unitById = new Map(frame.units.map((u) => [u.id, u]));

  /* Children and grandchildren are staggered within their own sibling group,
   * in the order the planner already placed them (left to right IS birth
   * order — see plan.js), so the stagger and the layout agree by
   * construction rather than by two separate sorts hopefully matching. */
  const groupIndex = new Map();
  for (const b of frame.bonds) {
    if (b.kind !== 'descent') continue;
    const sibs = frame.bonds
      .filter((x) => x.kind === 'descent' && x.parentUnit === b.parentUnit)
      .map((x) => x.child)
      .sort((p, q) => (frame.nodes.get(p)?.x ?? 0) - (frame.nodes.get(q)?.x ?? 0));
    groupIndex.set(b.child, sibs.indexOf(b.child));
  }

  frame.bonds.forEach((b, i) => {
    const key = bondKey(b, i);
    // A 'thread' (two people linked by a shared child, never partnered) is
    // scheduled exactly like a union — it is the same kind of "connects two
    // already-placed people" bond, just drawn differently.
    if (b.kind === 'union' || b.kind === 'thread') {
      const other = b.a === frame.focusId ? b.b : b.a;
      const node = frame.nodes.get(other);
      const row = node?.row ?? 0;
      // A union involving the focus leads the whole score: their partner is
      // the first thing to arrive, so the frame opens from the couple.
      const touchesFocus = b.a === frame.focusId || b.b === frame.focusId;
      const delay = touchesFocus
        ? (b.status === 'former' ? 130 : 0)
        : rowDelay(row) + 40;
      bonds.set(key, { delay, dur: BOND_MS });
      assign(nodes, other, delay, BOND_MS, frame.focusId);
      assign(nodes, b.a, delay, BOND_MS, frame.focusId);
      assign(nodes, b.b, delay, BOND_MS, frame.focusId);
    } else {
      const child = frame.nodes.get(b.child);
      const parentUnit = unitById.get(b.parentUnit);
      if (!child || !parentUnit) return;
      // A descent bond is timed by whichever end is FURTHER from the focus —
      // the branch always grows away from what is already on screen.
      const row = Math.abs(child.row) > Math.abs(parentUnit.row) ? child.row : parentUnit.row;
      const idx = groupIndex.get(b.child) ?? 0;
      const delay = rowDelay(row) + idx * STAGGER_MS;
      bonds.set(key, { delay, dur: BOND_MS });
      // Whichever end is not already scheduled opens at this branch's tip.
      assign(nodes, b.child, delay, BOND_MS, frame.focusId);
      const parentIds = parentUnit.anchorMemberIds?.length
        ? parentUnit.anchorMemberIds
        : parentUnit.memberIds;
      for (const m of parentIds) assign(nodes, m, delay, BOND_MS, frame.focusId);
    }
  });

  // Anyone the bonds never reached (an isolated focus, a lone parent with no
  // drawn partner) still needs a schedule — nothing may render unscheduled.
  for (const [id, n] of frame.nodes) {
    if (!nodes.has(id)) nodes.set(id, { delay: rowDelay(n.row), dur: BUD_MS });
  }

  let total = 0;
  for (const s of nodes.values()) total = Math.max(total, s.delay + s.dur);
  for (const s of bonds.values()) total = Math.max(total, s.delay + s.dur);
  // Horizon marks come in last and quietly, once the shape has settled.
  const horizonDelay = total + 40;
  total = horizonDelay + 160;

  return { bonds, nodes, total, horizonDelay, horizonDur: 160, reduced: false };
}

/* A person is scheduled by whichever branch reaches them FIRST — later
 * bonds to the same person must not push them back, or a child with two
 * drawn parents would open twice as late as a child with one. */
function assign(nodes, id, bondDelay, bondDur, focusId) {
  if (id === focusId) return;
  const delay = bondDelay + bondDur * ARRIVAL;
  const existing = nodes.get(id);
  if (existing && existing.delay <= delay) return;
  nodes.set(id, { delay, dur: BUD_MS });
}

export function bondKey(b, i) {
  if (b.kind === 'union') return `b:u:${b.a}:${b.b}`;
  if (b.kind === 'thread') return `b:t:${b.a}:${b.b}`;
  return `b:d:${b.parentUnit}:${b.child}:${i}`;
}

/** Normalised 0..1 progress of one scheduled item at time `t` (ms). */
export function progressAt(schedule, t) {
  if (!schedule) return 1;
  if (schedule.dur <= 0) return 1;
  const u = (t - schedule.delay) / schedule.dur;
  return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

/** Growth easing — decisive out, no bounce. A branch does not overshoot. */
export const easeBranch = (u) => 1 - Math.pow(1 - u, 3);

/** Bud opening — a whisper of overshoot so arrival has a little life. */
export function easeBud(u) {
  if (u >= 1) return 1;
  const c = 1.70158 * 0.6;
  return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2);
}
