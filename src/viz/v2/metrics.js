/*
 * Frame-by-frame motion instrumentation.
 *
 * Built into the engine rather than bolted onto the lab, because the claims
 * this experiment has to defend are claims ABOUT MOTION — "the selected person
 * never moves", "macro motion settles", "nothing oscillates" — and those can
 * only be checked by watching every frame of a real transition. The same
 * recorder feeds the dev overlay and the assertions in
 * tests/treeMotionV2.test.mjs, so what a reviewer sees on screen and what CI
 * enforces are the same numbers.
 */

export class MotionRecorder {
  constructor({ limit = 4000 } = {}) {
    this.limit = limit;
    this.reset();
  }

  reset(label = null) {
    this.label = label;
    this.frames = [];
    this.t = 0;
    this.transitionStartedAt = null;
    this.settledAt = null;
  }

  beginTransition(label) {
    this.label = label;
    this.transitionStartedAt = this.t;
    this.settledAt = null;
  }

  /**
   * @param {object} f
   * @param {number} f.dt              seconds
   * @param {number} f.peakSpeed       fastest node, world units/s
   * @param {number} f.meanSpeed       mean node speed
   * @param {number} f.activeDrift     how far the active person moved ON SCREEN this frame (px)
   * @param {number} f.cameraSpeed     camera screen-anchor speed (px/s)
   * @param {number} f.zoom
   * @param {number} f.unsettled       nodes not yet at rest
   * @param {number} f.maxPush         largest collision displacement applied (world units)
   * @param {boolean} f.settled
   */
  frame(f) {
    this.t += f.dt;
    if (this.frames.length < this.limit) this.frames.push({ t: this.t, ...f });
    if (f.settled && this.settledAt == null && this.transitionStartedAt != null) {
      this.settledAt = this.t;
    }
  }

  /** Aggregate the numbers a reviewer (and CI) actually judges the run on. */
  summary() {
    const fr = this.frames;
    if (!fr.length) return null;
    const since = this.transitionStartedAt ?? 0;
    const inTransition = fr.filter((q) => q.t >= since);
    const peak = Math.max(...fr.map((q) => q.peakSpeed));
    const totalActiveDrift = inTransition.reduce((s, q) => s + q.activeDrift, 0);
    const maxActiveDrift = Math.max(0, ...inTransition.map((q) => q.activeDrift));
    const maxPush = Math.max(0, ...fr.map((q) => q.maxPush ?? 0));

    // Overshoot detection: with critically damped springs the count of
    // unsettled nodes must never go UP inside a transition. If it does,
    // something is fighting the springs and the run is not converging.
    let reboundFrames = 0;
    for (let i = 1; i < inTransition.length; i++) {
      if (inTransition[i].unsettled > inTransition[i - 1].unsettled) reboundFrames++;
    }

    return {
      label: this.label,
      frames: fr.length,
      durationMs: Math.round(this.t * 1000),
      settleMs: this.settledAt == null ? null : Math.round((this.settledAt - since) * 1000),
      peakSpeed: Math.round(peak),
      maxActiveDriftPx: Number(maxActiveDrift.toFixed(4)),
      totalActiveDriftPx: Number(totalActiveDrift.toFixed(4)),
      maxCollisionPush: Number(maxPush.toFixed(2)),
      reboundFrames,
      settled: !!(this.settledAt != null),
    };
  }

  /** Compact series for the overlay's sparkline. */
  series(key, samples = 120) {
    const step = Math.max(1, Math.floor(this.frames.length / samples));
    const out = [];
    for (let i = 0; i < this.frames.length; i += step) out.push(this.frames[i][key] ?? 0);
    return out;
  }
}
