/*
 * The real geometry behind a single-corner page curl (the Kindle/Apple
 * Books "grab a corner, the paper wraps around a cylinder" effect) —
 * pure functions, no rendering, no animation loop. The finger drives
 * every value here directly; there is no easing baked in anywhere in
 * this file. That belongs in the renderer's release/settle physics, not
 * in the geometry itself.
 *
 * Model: the paper is pinned at `corner` and wraps around an imaginary
 * cylinder whose radius grows with how far the touch point has been
 * pulled away from the corner. A point at distance `u` from the corner,
 * measured along the corner→touch axis:
 *   - stays flat while u is small (near the spine/pinned edge)
 *   - curves over the top of the cylinder as u approaches the radius
 *     (theta = u / radius crossing 0 → π/2, the lit front face)
 *   - passes onto the cylinder's underside beyond that (π/2 → π, the
 *     shadowed back face — this is the part showing the page's *back*)
 *   - vanishes once theta ≥ π — fully wrapped away, revealing whatever
 *     is underneath (the next/previous page).
 * radius = distance(corner, touch) / 2 places the touch point itself
 * just past the crest (theta ≈ 2 rad), matching how your finger actually
 * sits on the underside of the paper it's peeling back.
 */

export function curlRadius(cornerX, cornerY, touchX, touchY) {
  const dx = touchX - cornerX;
  const dy = touchY - cornerY;
  return Math.sqrt(dx * dx + dy * dy) / 2;
}

// The pull axis (u, toward the touch point) and its perpendicular (v, the
// fold-line direction), both unit vectors, plus the raw pull distance.
export function pullAxis(cornerX, cornerY, touchX, touchY) {
  const dx = touchX - cornerX;
  const dy = touchY - cornerY;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  return { ux: dx / length, uy: dy / length, vx: -dy / length, vy: dx / length, length };
}

// Any page-space point's (u, v) coordinates in the pull-axis frame,
// relative to the corner.
export function project(px, py, cornerX, cornerY, axis) {
  const rx = px - cornerX;
  const ry = py - cornerY;
  return { u: rx * axis.ux + ry * axis.uy, v: rx * axis.vx + ry * axis.vy };
}

const HALF_PI = Math.PI / 2;

/*
 * The transform for one strip at distance `u` from the corner.
 * Returns null (hidden) once the strip has wrapped fully out of view.
 * `newU` is where the strip now sits along the SAME pull axis; `depth`
 * is how far it's lifted off the page plane (unused for 2D position,
 * consumed by the renderer for shading and draw order); `litFace` is
 * true for the front (still catching light) vs. the shadowed underside.
 */
export function curlStrip(u, radius) {
  if (radius <= 0.0001) return { newU: u, depth: 0, theta: 0, hidden: false, litFace: true };
  const theta = u / radius;
  if (theta >= Math.PI) return { newU: null, depth: 0, theta, hidden: true, litFace: false };
  return {
    newU: radius * Math.sin(theta),
    depth: radius * (1 - Math.cos(theta)),
    theta,
    hidden: false,
    litFace: theta <= HALF_PI,
  };
}

/*
 * A brightness multiplier (0–1) for shading a strip: full light flat on
 * the page, dimming toward the crest, then a darker shadowed tone on the
 * underside as it rolls past the crest toward fully hidden.
 */
export function curlShade(theta) {
  if (theta <= HALF_PI) {
    const t = theta / HALF_PI;
    return 1 - t * 0.32; // 1.0 → 0.68 across the lit face
  }
  const t = Math.min(1, (theta - HALF_PI) / HALF_PI);
  return 0.68 - t * 0.5; // 0.68 → 0.18 across the shadowed underside
}
