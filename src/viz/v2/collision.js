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
 * Two properties make that safe:
 *
 *   1. It returns a DISPLACEMENT, clamped to MAX_PUSH, applied on top of the
 *      spring positions. It can nudge a node out from under a neighbour; it
 *      can never move anyone far enough to change which row or which family
 *      group they read as part of. The layout stays authoritative.
 *   2. The active person's displacement is forced to zero. They are the fixed
 *      point of the transition, and "mostly still" is not still.
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
   * @returns {Map<string,{x,y}>} clamped displacements, one per id
   */
  resolve(positions, pinnedId = null) {
    const nodes = [];
    for (const [id, pt] of positions) nodes.push({ id, x: pt.x, y: pt.y, ox: pt.x, oy: pt.y });
    const displacement = new Map();
    if (nodes.length < 2) {
      for (const n of nodes) displacement.set(n.id, { x: 0, y: 0 });
      return displacement;
    }

    // The pinned node participates as an OBSTACLE (fx/fy) so its neighbours are
    // pushed off it — it simply never moves itself.
    for (const n of nodes) {
      if (n.id === pinnedId) { n.fx = n.x; n.fy = n.y; }
    }

    const sim = forceSimulation(nodes)
      .randomSource(seededRandom(this.seed))
      .force('collide', forceCollide(this.radius).strength(0.8).iterations(this.iterations))
      .alpha(0.9)
      .alphaDecay(0)
      .velocityDecay(0.55)
      .stop();
    for (let i = 0; i < this.ticks; i++) sim.tick();
    sim.stop();

    for (const n of nodes) {
      if (n.id === pinnedId) { displacement.set(n.id, { x: 0, y: 0 }); continue; }
      let dx = n.x - n.ox;
      let dy = n.y - n.oy;
      const mag = Math.hypot(dx, dy);
      if (mag > MAX_PUSH) { const k = MAX_PUSH / mag; dx *= k; dy *= k; }
      displacement.set(n.id, { x: dx, y: dy });
    }
    return displacement;
  }
}
