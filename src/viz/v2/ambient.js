/*
 * Ambient breathing — the deliberate replacement for V1's leftover drift.
 *
 * V1 felt alive because its simulation never finished; the cost was that the
 * tree never held still and the composition kept sliding. V2 settles hard, so
 * the life has to be put back on purpose, and the rules for doing so are:
 *
 *   • bounded — a fixed amplitude in world units, so it can never accumulate
 *     into drift or move anyone far enough to change what the layout says;
 *   • a pure function of (id, time) — nothing integrates, nothing has state to
 *     wander, and stopping it returns everyone exactly to their target;
 *   • family-coherent — every member of a partner pod shares one phase, so a
 *     couple breathes together as one object rather than jostling each other.
 *     That is the "coherent family-unit elasticity" the brief asks for, and
 *     it's why this is keyed by unit rather than by person.
 *   • never applied to the active person, who must be exactly still.
 */

export const AMBIENT_AMPLITUDE = 1.6;   // world units
export const AMBIENT_PERIOD_S = 7.5;

/** Stable per-unit phase — same string always yields the same phase. */
function phaseOf(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000 * Math.PI * 2;
}

export function createAmbient({ amplitude = AMBIENT_AMPLITUDE, period = AMBIENT_PERIOD_S, enabled = true } = {}) {
  const phases = new Map();
  return {
    /** @param {Map<string,{id}>} unitOf person → unit, so a pod shares a phase */
    offsetFor(id, unitOf, timeSeconds) {
      if (!enabled || amplitude <= 0) return { x: 0, y: 0 };
      const key = unitOf?.get(id)?.id ?? id;
      if (!phases.has(key)) phases.set(key, phaseOf(key));
      const phase = phases.get(key);
      const t = (timeSeconds / period) * Math.PI * 2;
      // Two slightly different rates so the path is a slow lissajous rather
      // than a straight line — reads as breathing, not as a wobble.
      return {
        x: Math.sin(t + phase) * amplitude,
        y: Math.cos(t * 0.73 + phase) * amplitude * 0.7,
      };
    },
    get enabled() { return enabled && amplitude > 0; },
  };
}
