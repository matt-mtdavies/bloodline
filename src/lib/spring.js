/*
 * A tiny critically-tuned spring integrator. The camera glides toward the
 * focused person with a little life at the end — never a linear tween, never a
 * snap. This motion *is* the product (see §1), so it lives in one place and is
 * reused for x, y and zoom.
 */
export class Spring {
  constructor(value = 0, { stiffness = 120, damping = 18 } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  setTarget(t) {
    this.target = t;
  }

  // Jump instantly, no animation (used on first load / reduced motion).
  set(v) {
    this.value = v;
    this.target = v;
    this.velocity = 0;
  }

  // Semi-implicit Euler; dt clamped so a dropped frame can't explode the spring.
  step(dt) {
    const h = Math.min(dt, 1 / 30);
    const a = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
    this.velocity += a * h;
    this.value += this.velocity * h;
    return this.value;
  }

  get settled() {
    return Math.abs(this.value - this.target) < 0.05 && Math.abs(this.velocity) < 0.05;
  }
}
