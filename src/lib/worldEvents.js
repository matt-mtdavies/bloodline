import { WORLD_EVENTS } from '../data/worldEvents.js';

/*
 * World-history context for the family timeline. Kept deliberately separate
 * from lib/timeline.js's pure family-data functions — this is editorial
 * content layered on top, not part of the family's own record.
 */

// Loose keyword match against free-text birth_place/residence strings —
// there's no structured "country" field on a person, so this is a best-effort
// signal, not a hard classification. Order doesn't matter; ties fall back to
// 'global' rather than guessing.
const REGION_KEYWORDS = {
  AU: ['australia', 'nsw', 'vic', 'qld', 'wa', 'sa', 'tas', 'act', 'nt', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'canberra'],
  UK: ['england', 'wales', 'scotland', 'united kingdom', 'uk', 'britain', 'london', 'cardiff', 'bristol', 'glasgow', 'edinburgh', 'manchester', 'liverpool', 'birmingham'],
  IE: ['ireland', 'dublin', 'cork', 'galway', 'limerick'],
  US: ['united states', 'usa', 'u.s.', 'america', 'california', 'texas', 'new york', 'florida', 'chicago', 'boston'],
  CA: ['canada', 'ontario', 'toronto', 'quebec', 'vancouver', 'alberta'],
  NZ: ['new zealand', 'auckland', 'wellington', 'christchurch'],
};

// The tree's dominant region, by tallying every person's birth_place +
// residence against the keyword lists above. Falls back to 'global' for
// trees with no recognisable places, or a genuine tie.
export function detectRegion(graph) {
  const tally = new Map();
  for (const p of graph.people || []) {
    const text = `${p.birth_place || ''} ${p.residence || ''}`.toLowerCase();
    if (!text.trim()) continue;
    for (const [region, keywords] of Object.entries(REGION_KEYWORDS)) {
      if (keywords.some((k) => text.includes(k))) {
        tally.set(region, (tally.get(region) || 0) + 1);
      }
    }
  }
  let best = null, bestCount = 0;
  for (const [region, count] of tally) {
    if (count > bestCount) { best = region; bestCount = count; }
  }
  return best || 'global';
}

const matchesRegion = (e, region) => e.region === 'global' || e.region === region;

// Every world event that falls within a given decade, region-biased.
export function worldEventsInDecade(decade, region) {
  return WORLD_EVENTS.filter((e) => Math.floor(e.year / 10) * 10 === decade && matchesRegion(e, region));
}

// A single representative event sharing an exact year (region-specific
// preferred over global, for personal relevance), or null.
export function sameYearWorldEvent(year, region) {
  const matches = WORLD_EVENTS.filter((e) => e.year === year && matchesRegion(e, region));
  if (!matches.length) return null;
  return matches.find((e) => e.region === region) || matches[0];
}

// The closest world event to a given year, within maxDistance — used by the
// Time Mode year-scrubber, where an exact-year match would be rare given how
// sparse the curated list is (events are seeded roughly one per few years).
// Ties, and near-ties, prefer the region-specific event over a global one.
export function nearestWorldEvent(year, region, maxDistance = 4) {
  let best = null, bestDist = Infinity;
  for (const e of WORLD_EVENTS) {
    if (!matchesRegion(e, region)) continue;
    const d = Math.abs(e.year - year);
    if (d > maxDistance || d > bestDist) continue;
    if (d < bestDist || (best && e.region === region && best.region !== region)) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

// A subtle, warm-to-cool wash across the full span — old decades read a
// touch more sepia/aged, modern ones a touch cleaner/cooler — entirely
// within the app's existing warm-paper palette family, never a jarring
// color change. Used as the decade band's background tint.
const ERA_OLD = [0xf3, 0xe9, 0xd6];   // warm sepia-cream
const ERA_NEW = [0xf1, 0xf2, 0xf4];   // clean, cool-neutral paper
const ERA_SPAN = [1750, 2030];

export function eraTint(decade) {
  const t = Math.min(1, Math.max(0, (decade - ERA_SPAN[0]) / (ERA_SPAN[1] - ERA_SPAN[0])));
  const mix = (a, b) => Math.round(a + (b - a) * t);
  const [r, g, b] = [mix(ERA_OLD[0], ERA_NEW[0]), mix(ERA_OLD[1], ERA_NEW[1]), mix(ERA_OLD[2], ERA_NEW[2])];
  return `rgb(${r}, ${g}, ${b})`;
}
