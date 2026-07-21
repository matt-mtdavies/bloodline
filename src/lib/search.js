/*
 * Name-matching for the search overlay. Pure so it's unit-testable without
 * mounting the component — see tests/search.test.mjs.
 */

// Score a single field against a query; higher = better match.
export function scoreText(text, q) {
  const name = (text || '').toLowerCase();
  if (!name || !q) return 0;
  const parts = name.split(/\s+/);
  if (name === q)                        return 10;
  if (name.startsWith(q))                return 6;
  if (parts.some((w) => w.startsWith(q))) return 4;
  if (name.includes(q))                  return 2;
  if (parts[0]?.includes(q))             return 1; // "mat" → "Matthew"
  return 0;
}

// Ranks people by how well they match a free-text query, across name,
// birth/maiden name, middle name, occupation, and place (birth place +
// residence). Three priority BANDS, not one blended score — a match on the
// person's actual name always outranks a middle-name match, which always
// outranks an occupation/place match, regardless of how "good" a lower-band
// match scores within its own 0-10 range.
//
// This fixes a real reported bug: middle_name is stored as its own short,
// standalone field, so a full-word query can hit it as an EXACT match
// (score 10) while that same query can only ever hit a real "First Last"
// display name as a starts-with match (score 6 — the whole string is never
// literally equal to just the first name) — letting middle names win ties
// they shouldn't. Additive band offsets (wider than scoreText's own 0-10
// range) keep every band strictly ordered no matter how the within-band
// scores compare. Middle-name search itself isn't removed — it's a real,
// separately-edited field (EditPersonSheet) worth being able to find
// someone by — it's just correctly a fallback, not a competitor.
//
// Returns matches only (score > 0), sorted best-first then alphabetically,
// each tagged with _score plus the fields the result row needs to explain
// *why* it matched (_birthName/_middleName/_place, plus _matchedOccupation/
// _matchedPlace so the row only surfaces occupation/place as the reason
// once no higher-band field already explains the match).
const BAND_WIDTH = 20;
export function rankPeopleByName(people, query, limit = null) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const matches = people
    .map((p) => {
      // birth_name is the canonical field; maiden_name is legacy seed data.
      const birthName = p.birth_name || p.maiden_name || '';
      const middleName = p.middle_name || '';
      const place = [p.birth_place, p.residence].filter(Boolean).join(', ');

      const nameBand = Math.max(scoreText(p.display_name, q), scoreText(birthName, q));
      const middleBand = scoreText(middleName, q);
      const occScore = scoreText(p.occupation, q);
      const placeScore = scoreText(place, q);

      let score;
      if (nameBand > 0) score = nameBand + BAND_WIDTH * 2;
      else if (middleBand > 0) score = middleBand + BAND_WIDTH;
      else score = Math.max(occScore, placeScore);
      if (score <= 0) return null;

      // Only surfaced as the match reason once no higher-band field
      // matched — an occupation/place that merely happens to also contain
      // the query isn't why a name match showed up.
      const matchedByLowerBand = nameBand === 0 && middleBand === 0;
      return {
        ...p,
        _score: score,
        _birthName: birthName,
        _middleName: middleName,
        _place: place,
        _matchedOccupation: matchedByLowerBand && occScore > 0 && occScore >= placeScore,
        _matchedPlace: matchedByLowerBand && placeScore > 0 && placeScore > occScore,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b._score - a._score || a.display_name.localeCompare(b.display_name));
  return limit != null ? matches.slice(0, limit) : matches;
}
