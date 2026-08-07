/*
 * Critically damped springs — the motion half of V2.
 *
 * A critically damped spring is the fastest approach to a target that never
 * overshoots and never oscillates. That property is the whole point here: V1's
 * "aliveness" came from a force simulation that was still negotiating with
 * itself, so motion never truly stopped and the tree kept drifting. These
 * springs provably converge — the residual decays as (1 + ωt)·e^(−ωt) — so
 * macro motion SETTLES, and whatever life the tree has is put back
 * deliberately (see ambient.js) rather than left over from unfinished physics.
 *
 * The step is the closed-form solution rather than a numerical integrator, so
 * it is exact at any timestep: a dropped frame moves a node exactly as far as
 * the frames it replaced would have, instead of the overshoot an explicit
 * Euler step gives you when dt spikes. That also makes the tests independent
 * of frame pacing.
 */

/** Angular frequency from a "time to visually arrive" in seconds. */
export function omegaForSettleTime(seconds) {
  // For a critically damped system the residual is (1 + ωt)e^(−ωt); it falls
  // under 1 % at ωt ≈ 6.64. Expressing the knob as a duration keeps the tuning
  // in human terms rather than in stiffness units nobody can picture.
  return 6.64 / Math.max(0.001, seconds);
}

/**
 * One exact critically damped step.
 * @returns {[number, number]} the new [value, velocity]
 */
export function stepSpring(value, velocity, target, omega, dt) {
  if (dt <= 0) return [value, velocity];
  const decay = Math.exp(-omega * dt);
  const delta = value - target;
  const nextValue = target + (delta + (velocity + omega * delta) * dt) * decay;
  const nextVelocity = (velocity - (velocity + omega * delta) * omega * dt) * decay;
  return [nextValue, nextVelocity];
}

const EPS_POS = 0.05;   // world units — below a twentieth of a pixel, nobody can see it move
const EPS_VEL = 0.5;    // world units per second

/*
 * A bag of 2-D springs keyed by id. Targets are set wholesale from a layout
 * plan; the system reports when every one of them has genuinely arrived, which
 * is what lets the engine stop stepping instead of idling forever.
 */
export class SpringField {
  constructor({ settleSeconds = 0.62 } = {}) {
    this.omega = omegaForSettleTime(settleSeconds);
    this.state = new Map(); // id → { x, y, vx, vy, tx, ty }
    this.pinned = new Set();
  }

  /** Set (or replace) the whole target set. Unknown ids spawn at their target. */
  setTargets(targets, { spawnAt = null } = {}) {
    for (const [id, pt] of targets) {
      const prev = this.state.get(id);
      if (prev) {
        prev.tx = pt.x;
        prev.ty = pt.y;
      } else {
        const from = spawnAt?.(id) ?? pt;
        this.state.set(id, { x: from.x, y: from.y, vx: 0, vy: 0, tx: pt.x, ty: pt.y });
      }
    }
    for (const id of [...this.state.keys()]) if (!targets.has(id)) this.state.delete(id);
  }

  /**
   * Pin an id to its target exactly. Used for the active person: they are the
   * fixed point of the whole transition and must not even micro-drift, so they
   * are excluded from integration rather than merely given a stiff spring.
   */
  pin(id) { this.pinned.add(id); const s = this.state.get(id); if (s) { s.x = s.tx; s.y = s.ty; s.vx = 0; s.vy = 0; } }
  unpin(id) { this.pinned.delete(id); }
  clearPins() { this.pinned.clear(); }

  /** Advance every spring by dt seconds. Returns the peak speed seen. */
  step(dt) {
    let peak = 0;
    for (const [id, s] of this.state) {
      if (this.pinned.has(id)) { s.x = s.tx; s.y = s.ty; s.vx = 0; s.vy = 0; continue; }
      [s.x, s.vx] = stepSpring(s.x, s.vx, s.tx, this.omega, dt);
      [s.y, s.vy] = stepSpring(s.y, s.vy, s.ty, this.omega, dt);
      const speed = Math.hypot(s.vx, s.vy);
      if (speed > peak) peak = speed;
    }
    return peak;
  }

  /** True once every spring has arrived AND stopped. */
  settled() {
    for (const [id, s] of this.state) {
      if (this.pinned.has(id)) continue;
      if (Math.abs(s.x - s.tx) > EPS_POS || Math.abs(s.y - s.ty) > EPS_POS) return false;
      if (Math.hypot(s.vx, s.vy) > EPS_VEL) return false;
    }
    return true;
  }

  /** Snap everything to rest — used by reduced-motion and by test fast-forward. */
  snap() {
    for (const s of this.state.values()) { s.x = s.tx; s.y = s.ty; s.vx = 0; s.vy = 0; }
  }

  /**
   * Shift every already-tracked node's CURRENT value (and pending target) by
   * a constant offset — used when the world coordinate frame's own origin
   * moves, i.e. a different person becomes "active" and the layout re-plans
   * around THEM instead. Without this, a node's numeric spring value still
   * means "however far from the person who used to be active," which the
   * renderer immediately re-reads as "however far from the new one" — an
   * instant jump baked into the very first frame, invisible to any per-frame
   * drift metric because it happens before step() is ever called again.
   * Velocities are left untouched: a pure translation of the coordinate
   * frame doesn't change how fast anything is moving relative to it.
   */
  translate(dx, dy) {
    for (const s of this.state.values()) {
      s.x += dx; s.y += dy;
      s.tx += dx; s.ty += dy;
    }
  }

  positions() {
    const out = new Map();
    for (const [id, s] of this.state) out.set(id, { x: s.x, y: s.y });
    return out;
  }

  get(id) { return this.state.get(id); }
}

/*
 * A single scalar spring, for the camera's zoom and screen anchor. Same
 * closed-form step; kept separate so the camera can settle on its own schedule
 * and be asserted independently.
 */
export class Spring1D {
  constructor(value, { settleSeconds = 0.62 } = {}) {
    this.value = value;
    this.velocity = 0;
    this.target = value;
    this.omega = omegaForSettleTime(settleSeconds);
  }
  setTarget(v) { this.target = v; }
  jump(v) { this.value = v; this.target = v; this.velocity = 0; }
  step(dt) { [this.value, this.velocity] = stepSpring(this.value, this.velocity, this.target, this.omega, dt); }
  settled() { return Math.abs(this.value - this.target) <= EPS_POS && Math.abs(this.velocity) <= EPS_VEL; }
}

export const SPRING_EPS = { position: EPS_POS, velocity: EPS_VEL };
