/*
 * Places Lived timeline — pure layout geometry for the horizontal
 * `.places-route` connector (PlacesLived.jsx). Extracted rather than
 * computed inline so the geometry is unit-testable and the component stays
 * thin, the same split this codebase already uses for InsightModules'
 * migration chains and (briefly) the retired constellation map.
 *
 * Waypoints sit at fixed, evenly-spaced x positions (WAYPOINT_W + GAP per
 * step) — deliberately NOT geographically positioned (see the retired
 * lib/placesMap.js's own postmortem: encoding real-world distance in the
 * same space as chronology is exactly what caused that design to collide at
 * realistic data density). The connecting path is a gentle, alternating
 * quadratic-bezier wave through those fixed points — heavier and organic
 * ("a flight path," not a ruler-straight line) rather than a plain CSS
 * border, and drawn through the SAME dotZoneHeight/2 the dots themselves are
 * centered in via flexbox, so line and dots can never drift apart the way a
 * hand-tuned `top: Npx` pseudo-element did.
 *
 * A border-crossing marker (a small paper-plane icon in PlacesLived.jsx) is
 * placed at the midpoint of any segment where both residences have a known,
 * differing `country` — never guessed when either side hasn't been geocoded
 * yet.
 */
export const WAYPOINT_W = 116;
export const GAP = 20;
const STEP = WAYPOINT_W + GAP;
export const DOT_ZONE_H = 40;
const WAVE_AMPLITUDE = 9;

export function buildTimelineLayout(residences) {
  const n = residences?.length || 0;
  if (n === 0) return null;

  const width = n * WAYPOINT_W + Math.max(0, n - 1) * GAP;
  const centerY = DOT_ZONE_H / 2;
  const points = residences.map((r, i) => ({
    id: r.id,
    x: i * STEP + WAYPOINT_W / 2,
    y: centerY,
    country: r.country || null,
  }));

  let pathD = '';
  const crossings = [];
  if (n >= 2) {
    pathD = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const a = points[i], b = points[i + 1];
      const mx = (a.x + b.x) / 2;
      const dir = i % 2 === 0 ? -1 : 1;
      const cy = centerY + WAVE_AMPLITUDE * dir;
      pathD += ` Q ${mx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
      if (a.country && b.country && a.country !== b.country) {
        const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        crossings.push({ key: `${a.id}-${b.id}`, x: mx, y: cy, angle });
      }
    }
  }

  return { width, height: DOT_ZONE_H, points, pathD, crossings };
}
