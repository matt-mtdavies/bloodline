import { forceSimulation, forceCollide } from 'd3-force';

/*
 * Local collision relief — the ONLY thing D3 still does in V2.
 *
 * In V1, d3-force owned the layout: charge, links, generation bands and
 * collision all argued about every node every frame, and the arrangement you
 * saw was whatever they settled on. Here the arrangement is already decided
 * (layoutPlanner.js) and collision has exactly one job: stop two bubbles
 * visually overlapping when the composition packs them tight.
 *
 * Three properties make that safe:
 *
 *   1. It returns a DISPLACEMENT, clamped to MAX_PUSH, applied on top of the
 *      spring positions. It can nudge a node out from under a neighbour; it
 *      can never move anyone far enough to change which row or which family
 *      group they read as part of. The layout stays authoritative.
 *   2. The active person's displacement is forced to zero. They are the fixed
 *      point of the transition, and "mostly still" is not still.
 *   3. Resolution happens at the PARTNER-POD level, not per person: every
 *      member of one pod is collapsed into a single simulation particle
 *      (centred on the pod's own current centroid, sized to its actual
 *      width) and receives the IDENTICAL resulting displacement. Resolving
 *      per person let two members of the same rigid pod get pushed by
 *      different amounts — a real reported bug, visibly stretching or
 *      squashing a couple's own fixed spacing whenever the composition
 *      packed them tight enough to reach the clamp. Fewer, larger particles
 *      also collide with each other far less often than many small ones
 *      packed edge to edge, which is why ordinary fixtures now rarely
 *      saturate the clamp at all (see treeMotionV2.test.mjs's own assertion
 *      on this).
 *
 * Determinism: d3's collide calls jiggle() (which uses a random source) when
 * two nodes are exactly coincident. It inherits that source from the
 * simulation, so the simulation is given a seeded LCG and identical input
 * produces identical output — which is what lets the integrated motion tests
 * assert on exact numbers instead of tolerances.
 */

/** Maximum distance collision may move any node from where the layout put it. */
export const MAX_PUSH = 14;

/** Mulberry32 — small, fast, and identical on every platform and run. */
function seededRandom(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class LocalCollision {
  constructor({ radius = 66, iterations = 2, ticks = 4, seed = 1234567 } = {}) {
    this.radius = radius;
    this.iterations = iterations;
    this.ticks = ticks;
    this.seed = seed;
  }

  /**
   * @param {Map<string,{x,y}>} positions spring output (never mutated)
   * @param {string|null} pinnedId person who must not move at all
   * @param {Map<string,{id,memberIds}>|null} [unitOf] the planner's person →
   *   partner-pod map. When given, every member of one pod receives the
   *   IDENTICAL displacement — the average of what the simulation computed
   *   for each of them individually — so a pod can never be stretched
   *   internally. Omit it to fall back to resolving each person independently.
   * @returns {Map<string,{x,y}>} clamped displacements, one per id
   */
  resolve(positions, pinnedId = null, unitOf = null) {
    const nodes = [];
    for (const [id, pt] of positions) nodes.push({ id, x: pt.x, y: pt.y, ox: pt.x, oy: pt.y });
    const displacement = new Map();
    if (nodes.length < 2) {
      for (const n of nodes) displacement.set(n.id, { x: 0, y: 0 });
      return displacement;
    }

    // Every member of the pinned person's pod is an obstacle (fx/fy) — the
    // whole pod is the fixed point, not just the literal active person.
    const pinnedSet = new Set(pinnedId != null ? (unitOf?.get(pinnedId)?.memberIds ?? [pinnedId]) : []);
    for (const n of nodes) {
      if (pinnedSet.has(n.id)) { n.fx = n.x; n.fy = n.y; }
    }

    // The simulation runs on real, individually-sized people — deliberately
    // NOT one oversized circle per pod. An earlier version of this fix
    // collapsed each pod into a single particle sized to its own half-width,
    // which is accurate left-to-right but wildly overstates a WIDE pod's
    // footprint top-to-bottom, producing phantom "collisions" with the row
    // above or below it that never actually overlap on screen.
    const sim = forceSimulation(nodes)
      .randomSource(seededRandom(this.seed))
      .force('collide', forceCollide(this.radius).strength(0.8).iterations(this.iterations))
      .alpha(0.9)
      .alphaDecay(0)
      .velocityDecay(0.55)
      .stop();
    for (let i = 0; i < this.ticks; i++) sim.tick();
    sim.stop();

    // Group the resulting RAW per-person displacements by pod and project
    // their average back onto every member — that single shared correction,
    // clamped once as a pod, is what keeps the pod rigid without distorting
    // the collision geometry that produced it.
    const groups = new Map(); // pod key → member ids
    for (const n of nodes) {
      const unit = unitOf?.get(n.id) ?? null;
      const key = unit ? unit.id : `solo:${n.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }

    for (const members of groups.values()) {
      if (pinnedSet.has(members[0].id)) {
        for (const n of members) displacement.set(n.id, { x: 0, y: 0 });
        continue;
      }
      let sx = 0, sy = 0;
      for (const n of members) { sx += n.x - n.ox; sy += n.y - n.oy; }
      let dx = sx / members.length;
      let dy = sy / members.length;
      const mag = Math.hypot(dx, dy);
      if (mag > MAX_PUSH) { const k = MAX_PUSH / mag; dx *= k; dy *= k; }
      for (const n of members) displacement.set(n.id, { x: dx, y: dy });
    }
    return displacement;
  }
}
