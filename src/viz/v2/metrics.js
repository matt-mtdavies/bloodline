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

/*
 * Explicit pass/fail thresholds — named, so a reviewer (or CI) is checking
 * against a stated bar rather than eyeballing raw numbers. A real gap in the
 * FIRST version of this file: zero active-person drift and zero rebound
 * frames coexisted with a genuine, visible jump of everyone ELSE in the
 * scene (a peak speed near 4,000 world units/s from a discontinuity, not a
 * real journey) — because nothing here ever looked past the one person the
 * camera is anchored to. Every field below is watched by at least one of
 * `maxNodeDisplacementPx` (frame-to-frame, screen space, every node) or
 * `selectionBoundaryJumpPx` (the instant of select() itself, before any
 * step()) specifically so that class of bug is visible in the numbers, not
 * just in a screenshot.
 */
export const PASS_FAIL_THRESHOLDS = {
  maxActiveDriftPx: 0.5,          // the active person: must not move at all
  // Everyone else, at the instant of select(). Bounded by ambient breathing
  // resuming for whoever just STOPPED being active (their sine phase kept
  // advancing the whole time it was suppressed, so it can resume anywhere in
  // its cycle): hypot(AMBIENT_AMPLITUDE, AMBIENT_AMPLITUDE*0.7) ≈ 1.95 world
  // units, times up to maxZoom (1.35) ≈ 2.64px. This is a real, understood,
  // irreducible source — not a re-opened version of the coordinate-jump bug
  // this metric primarily exists to catch (that bug measured 47–129px).
  selectionBoundaryJumpPx: 3,
  // Any node, screen space, in a single frame. A critically damped spring's
  // peak velocity scales with how far it has to travel in a FIXED settle
  // time (v_peak ≈ 0.368·ω·distance — the maximum of x0·(1+ωt)e^(−ωt)'s
  // derivative) — so a node whose family recomposes it across a wide layout
  // (this bench's `distant-pull`/`partner-chain`/`three-pod` fixtures
  // deliberately include such cases) legitimately posts a high single-frame
  // speed while still converging smoothly, with zero direction reversals and
  // zero rebound frames. A full sweep of every person in every fixture
  // (`P2 fix: every real, undisturbed transition...` in
  // tests/treeMotionV2.test.mjs) found this bench's worst real case at
  // ~159px; 200 leaves headroom without hiding an actual discontinuity — a
  // genuine bug reads as an ISOLATED, non-decaying spike (see the fixed P1
  // coordinate-jump class, 47–129px with no ramp-up), which
  // directionReversals/reboundFrames catch independently of this number.
  maxNodeDisplacementPx: 200,
  maxCollisionPush: 14,           // MAX_PUSH in collision.js — kept in sync there, not imported here to avoid a cross-module coupling metrics.js has no other reason to have
  maxDirectionReversals: 0,       // a critically damped spring never overshoots — ANY reversal means something is fighting the springs
  reboundFrames: 0,               // the unsettled count must never rise inside a transition
};

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
    this.selectionBoundaryJumpPx = 0;
  }

  /**
   * @param {string} label
   * @param {object} [meta]
   * @param {number} [meta.selectionBoundaryJumpPx] the max screen-space jump
   *   of any already-tracked node at the INSTANT of select() — before a
   *   single step() has run. This is the one number the frame-by-frame
   *   metrics below structurally cannot see, since it happens between two
   *   calls, not during a frame.
   */
  beginTransition(label, meta = {}) {
    this.label = label;
    this.transitionStartedAt = this.t;
    this.settledAt = null;
    this.selectionBoundaryJumpPx = meta.selectionBoundaryJumpPx ?? 0;
  }

  /**
   * @param {object} f
   * @param {number} f.dt              seconds
   * @param {number} f.peakSpeed       fastest node, world units/s
   * @param {number} f.meanSpeed       mean node speed
   * @param {number} f.activeDrift     how far the active person moved ON SCREEN this frame (px)
   * @param {number} f.cameraSpeed     camera screen-anchor speed (px/s)
   * @param {number} f.zoom
   * @param {number} f.zoomVelocity    zoom spring velocity (1/s)
   * @param {number} f.unsettled       nodes not yet at rest
   * @param {number} f.maxPush         largest collision displacement applied (world units)
   * @param {number} [f.maxNodeDisplacementPx] largest screen-space move of ANY
   *   node (not just the active person) since the previous frame
   * @param {number} [f.maxAcceleration] largest frame-to-frame speed change of
   *   any spring, world units/s²
   * @param {number} [f.directionReversals] count of springs whose velocity
   *   direction flipped since the previous frame (should always be 0)
   * @param {number} [f.collisionPushDelta] largest frame-to-frame change in
   *   any one node's collision push, world units
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
    const maxNodeDisplacement = Math.max(0, ...inTransition.map((q) => q.maxNodeDisplacementPx ?? 0));
    const maxAcceleration = Math.max(0, ...fr.map((q) => q.maxAcceleration ?? 0));
    const totalReversals = inTransition.reduce((s, q) => s + (q.directionReversals ?? 0), 0);
    const maxPushDelta = Math.max(0, ...fr.map((q) => q.collisionPushDelta ?? 0));
    const maxZoomVelocity = Math.max(0, ...fr.map((q) => Math.abs(q.zoomVelocity ?? 0)));
    const maxCameraSpeed = Math.max(0, ...fr.map((q) => q.cameraSpeed ?? 0));

    // Overshoot detection: with critically damped springs the count of
    // unsettled nodes must never go UP inside a transition. If it does,
    // something is fighting the springs and the run is not converging.
    let reboundFrames = 0;
    for (let i = 1; i < inTransition.length; i++) {
      if (inTransition[i].unsettled > inTransition[i - 1].unsettled) reboundFrames++;
    }

    const summary = {
      label: this.label,
      frames: fr.length,
      durationMs: Math.round(this.t * 1000),
      settleMs: this.settledAt == null ? null : Math.round((this.settledAt - since) * 1000),
      peakSpeed: Math.round(peak),
      maxActiveDriftPx: Number(maxActiveDrift.toFixed(4)),
      totalActiveDriftPx: Number(totalActiveDrift.toFixed(4)),
      selectionBoundaryJumpPx: Number(this.selectionBoundaryJumpPx.toFixed(4)),
      maxNodeDisplacementPx: Number(maxNodeDisplacement.toFixed(2)),
      maxAcceleration: Math.round(maxAcceleration),
      directionReversals: totalReversals,
      maxCollisionPush: Number(maxPush.toFixed(2)),
      maxCollisionPushDelta: Number(maxPushDelta.toFixed(2)),
      maxZoomVelocity: Number(maxZoomVelocity.toFixed(3)),
      maxCameraSpeedPxPerS: Math.round(maxCameraSpeed),
      reboundFrames,
      settled: !!(this.settledAt != null),
    };
    const v = verdict(summary);
    summary.passed = v.passed;
    summary.failures = v.failures;
    return summary;
  }

  /** Compact series for the overlay's sparkline. */
  series(key, samples = 120) {
    const step = Math.max(1, Math.floor(this.frames.length / samples));
    const out = [];
    for (let i = 0; i < this.frames.length; i += step) out.push(this.frames[i][key] ?? 0);
    return out;
  }
}

/**
 * Evaluate a summary (as produced by MotionRecorder#summary()) against the
 * named PASS_FAIL_THRESHOLDS. Pure and standalone so the SAME check runs in
 * the dev overlay and in tests — a reviewer sees exactly what CI enforces.
 * @param {ReturnType<MotionRecorder['summary']>} summary
 */
export function verdict(summary) {
  const failures = [];
  const check = (key, value, cmp = (v, t) => v <= t) => {
    const threshold = PASS_FAIL_THRESHOLDS[key];
    if (value != null && !cmp(value, threshold)) {
      failures.push(`${key}: ${value} exceeds threshold ${threshold}`);
    }
  };
  check('maxActiveDriftPx', summary.maxActiveDriftPx);
  check('selectionBoundaryJumpPx', summary.selectionBoundaryJumpPx);
  check('maxNodeDisplacementPx', summary.maxNodeDisplacementPx);
  check('maxCollisionPush', summary.maxCollisionPush);
  check('maxDirectionReversals', summary.directionReversals);
  check('reboundFrames', summary.reboundFrames);
  return { passed: failures.length === 0, failures };
}
