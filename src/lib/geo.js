/*
 * Family Moments slice 3 — pure distance math over already-geocoded
 * coordinates. Geocoding itself (place string -> {lat, lon}) happens
 * server-side (functions/_lib/geocode.js, a Nominatim proxy with a D1
 * cache) — this file never makes a network call, matching lib/
 * insightModules.js's own "graph in, pure data out" convention.
 */
const EARTH_RADIUS_KM = 6371;

export function haversineKm(a, b) {
  if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// Rounded to the nearest whole km for display — this is a town/city-level
// distance (the underlying geocoding never resolves to street precision),
// so a decimal place would read as a false precision the data doesn't have.
export function formatKm(km) {
  if (km == null) return null;
  return Math.round(km);
}
