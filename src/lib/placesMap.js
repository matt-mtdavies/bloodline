/*
 * Places Lived — the "constellation map" visualization (PlacesMap.jsx). Pure,
 * unit-tested geometry: turns a person's residences[] into a small set of
 * plotted points + a single organic curved path through them, in the exact
 * chronological order they were lived in.
 *
 * Deliberately NOT a real map — no basemap tiles, no map library dependency,
 * consistent with this app's existing preference for lightweight custom SVG
 * over heavy third-party visualization (see InsightModules.jsx's migration
 * chains, Keepsake's constellationLayout). Each axis is independently
 * min/max-normalized to fill the available box — this distorts true
 * geographic proportions (a real equirectangular projection would compress
 * longitude near the poles), but that's the deliberate trade: an abstract,
 * emotionally-legible "journey" shape rather than a literal, accurate map.
 *
 * Gated at 2+ geocoded places: a lone dot floating with no path is a
 * placeholder, not a visualization worth showing — same "never half-render"
 * principle every other insight/module in this codebase already follows.
 * Residences with no lat/lon (geocoding never ran, or failed) are simply
 * excluded from the plot — the chain/cards below PlacesMap already show
 * every residence regardless of geocode status; this is an enrichment layer,
 * not the source of truth.
 */

const DEFAULT_OPTS = {
  width: 340,
  height: 176,
  padding: 30,
  minRadius: 5,
  maxRadius: 12,
};

// Same "unknown date sorts last" convention as PlacesLived.jsx's own
// residences.sort(), duplicated rather than imported — this module has no
// component dependency and shouldn't need one for one small ordering rule.
function chronological(a, b) {
  if (a.from_year == null) return 1;
  if (b.from_year == null) return -1;
  return a.from_year - b.from_year;
}

function normalize(value, min, max, outMin, outMax) {
  if (max === min) return (outMin + outMax) / 2;
  return outMin + ((value - min) / (max - min)) * (outMax - outMin);
}

// A person who lived somewhere on multiple continents AND made one short
// local move (e.g. Cardiff -> Bristol, ~40km, then -> Toronto, ~5800km) will
// otherwise have the local move's two dots land almost exactly on top of
// each other — both axes are normalized against the SAME global min/max, so
// a short hop is invisible next to an intercontinental one. A few passes of
// simple mutual repulsion (nudge any two dots closer than their combined
// radius + a gap apart, split evenly between them) keeps every place
// visually distinct without needing true geographic accuracy — this is
// already an abstract, not-to-scale plot (see the file header), so nudging
// positions slightly for legibility is consistent with that trade-off, not
// a new one.
const MIN_GAP = 10;
function separate(points, { padding, width, height }) {
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = a.r + b.r + MIN_GAP;
        if (dist >= minDist) continue;
        moved = true;
        // Points sharing the exact same spot have no direction to push
        // along — pick a small deterministic offset (index-based, so it's
        // stable across re-renders) rather than a random one.
        const angle = dist > 0.01 ? Math.atan2(dy, dx) : (i * 2.4 + j);
        const push = (minDist - dist) / 2 + 0.5;
        a.x -= Math.cos(angle) * push;
        a.y -= Math.sin(angle) * push;
        b.x += Math.cos(angle) * push;
        b.y += Math.sin(angle) * push;
      }
    }
    if (!moved) break;
  }
  // Clamp back inside the card after nudging — separation must never push
  // a dot (or its label) out from under the visible box.
  for (const p of points) {
    p.x = Math.min(width - padding, Math.max(padding, p.x));
    p.y = Math.min(height - padding, Math.max(padding, p.y));
  }
}

// Which side a label should anchor from, so it's never clipped by the
// card's rounded (overflow:hidden) edge regardless of how close its dot
// sits to the left/right boundary.
function labelAnchor(x, width) {
  if (x < width * 0.22) return 'start';
  if (x > width * 0.78) return 'end';
  return 'middle';
}

// A gentle, organic curve through the points — consecutive quadratic Bezier
// segments, each control point offset perpendicular to its segment
// (alternating side each hop) so the route reads as a hand-drawn travel path
// rather than a rigid ruler-straight polyline.
function buildPath(points) {
  if (points.length < 2) return '';
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // unit perpendicular
    const offset = Math.min(len * 0.18, 22) * (i % 2 === 0 ? 1 : -1);
    const cx = mx + nx * offset, cy = my + ny * offset;
    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}

export function projectPlaces(residences, opts = {}) {
  const { width, height, padding, minRadius, maxRadius } = { ...DEFAULT_OPTS, ...opts };
  const now = opts.now ?? new Date().getFullYear();

  const geocoded = (residences || []).filter(
    (r) => Number.isFinite(r.lat) && Number.isFinite(r.lon),
  );
  if (geocoded.length < 2) return null;

  const ordered = [...geocoded].sort(chronological);

  const lats = ordered.map((r) => r.lat);
  const lons = ordered.map((r) => r.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);

  // Duration-based radius. A residence missing either year has an unknowable
  // duration and gets the midpoint radius — never a guessed span.
  const durations = ordered.map((r) => {
    if (r.from_year == null) return null;
    const end = r.to_year ?? now;
    const d = end - r.from_year;
    return Number.isFinite(d) && d >= 0 ? d : null;
  });
  const known = durations.filter((d) => d != null);
  const minDur = known.length ? Math.min(...known) : 0;
  const maxDur = known.length ? Math.max(...known) : 0;

  // The one residence read as "current": whichever has no end year (still
  // lives there), preferring the most recently started if more than one
  // (shouldn't normally happen); otherwise the chronologically last entry.
  const openEnded = ordered.filter((r) => r.to_year == null && r.from_year != null);
  const currentSource = openEnded.length
    ? openEnded.reduce((a, b) => (b.from_year > a.from_year ? b : a))
    : ordered[ordered.length - 1];

  const points = ordered.map((r, i) => {
    const x = normalize(r.lon, minLon, maxLon, padding, width - padding);
    const y = normalize(r.lat, maxLat, minLat, padding, height - padding); // inverted: north up
    const dur = durations[i];
    const radius = dur == null
      ? (minRadius + maxRadius) / 2
      : normalize(dur, minDur, maxDur, minRadius, maxRadius);
    return {
      id: r.id,
      place: r.place,
      from_year: r.from_year ?? null,
      to_year: r.to_year ?? null,
      x, y,
      r: radius,
      current: r === currentSource,
    };
  });

  separate(points, { padding, width, height });
  for (const p of points) p.labelAnchor = labelAnchor(p.x, width);

  return { points, pathD: buildPath(points), width, height };
}
