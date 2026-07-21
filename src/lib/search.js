/*
 * Name-matching for the search overlay. Pure so it's unit-testable without
 * mounting the component — see tests/search.test.mjs.
 */

// Score a single field against a query; higher = better match. Still used
// as-is for occupation/place, which are phrases rather than name tokens
// people casually reorder.
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

function tokenize(text) {
  return (text || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
}

// Scores one query word against a bag of a person's name words — their own
// word order is irrelevant here, this only asks "does ANY of their words
// match this ONE query word".
function scoreWordAgainst(word, candidateWords) {
  if (candidateWords.includes(word))                 return 10;
  if (candidateWords.some((w) => w.startsWith(word))) return 6;
  if (candidateWords.some((w) => w.includes(word)))   return 2;
  return 0;
}

// Scores every word of a (possibly multi-word) query against a person's
// name, split into a "primary" word bag (display name + birth/maiden name)
// and a "secondary" bag (middle name). Every query word must find a home in
// ONE of the two bags — strict AND, not OR: a query word that matches
// nothing at all disqualifies the person outright rather than the search
// silently broadening. Returns null when the person isn't a match at all.
//
// This is what makes matching order- and field-independent: "robert turner"
// and "turner robert" score identically (each word is checked on its own,
// regardless of position), and "robert george" can match someone whose
// first+last name is "Robert Turner" with middle name "George" — the two
// query words don't have to come from the same field, let alone the order
// that field happens to store them in.
function scoreNameTokens(queryWords, primaryWords, secondaryWords) {
  let total = 0;
  let usedSecondary = false;
  for (const word of queryWords) {
    let s = scoreWordAgainst(word, primaryWords);
    if (s === 0 && secondaryWords.length) {
      s = scoreWordAgainst(word, secondaryWords);
      if (s > 0) usedSecondary = true;
    }
    if (s === 0) return null; // this query word matches nothing — disqualified
    total += s;
  }
  // Average, not sum, so a multi-word query stays on the same 0-10 scale a
  // single word would — keeps the BAND_WIDTH separation below correct no
  // matter how many words were typed.
  return { avg: total / queryWords.length, usedSecondary };
}

// Ranks people by how well they match a free-text query, across name,
// birth/maiden name, middle name, occupation, and place (birth place +
// residence). Three priority BANDS, not one blended score — a match on the
// person's actual name always outranks a middle-name match, which always
// outranks an occupation/place match, regardless of how "good" a lower-band
// match scores within its own 0-10 range.
//
// The query is tokenized into words and matched order-independently against
// a person's own name words (see scoreNameTokens above) rather than testing
// each whole field against the whole, un-split query string — this fixes a
// real reported bug where "Robert Turner" was only found by typing "robert
// turner", never "turner robert", and a query split across the first name
// and a middle name ("robert george" for someone named Robert Turner with
// middle name George) never matched at all. If satisfying every query word
// requires reaching into the middle name for even one of them, the WHOLE
// match drops to the secondary band below any match satisfiable from
// primary fields alone — so reordering never lets a middle name jump ahead
// of someone's real name (a person literally named "Robert George" still
// outranks "Robert Turner" whose middle name happens to be George, for the
// same query).
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
  const queryWords = tokenize(q);
  const matches = people
    .map((p) => {
      // birth_name is the canonical field; maiden_name is legacy seed data.
      const birthName = p.birth_name || p.maiden_name || '';
      const middleName = p.middle_name || '';
      const place = [p.birth_place, p.residence].filter(Boolean).join(', ');

      const primaryWords = [...tokenize(p.display_name), ...tokenize(birthName)];
      const secondaryWords = tokenize(middleName);
      const nameResult = scoreNameTokens(queryWords, primaryWords, secondaryWords);
      const occScore = scoreText(p.occupation, q);
      const placeScore = scoreText(place, q);

      let score;
      if (nameResult && !nameResult.usedSecondary) score = nameResult.avg + BAND_WIDTH * 2;
      else if (nameResult)                          score = nameResult.avg + BAND_WIDTH;
      else                                           score = Math.max(occScore, placeScore);
      if (score <= 0) return null;

      // Only surfaced as the match reason once no higher-band field
      // matched — an occupation/place that merely happens to also contain
      // the query isn't why a name match showed up.
      const matchedByLowerBand = !nameResult;
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
