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

// Ranks people by how well their display name, birth/maiden name, and
// middle name match the query. Old-fashioned records often go by a middle
// name (e.g. display_name "Robert Mercer" for someone whose full given
// name — and search-worthy name — is "James Robert Mercer", middle_name
// "James"); middle_name is a real, separately-edited field (EditPersonSheet)
// that was never wired into search at all until this was added.
//
// Returns matches only (score > 0), sorted best-first then alphabetically,
// each tagged with _score/_birthName/_middleName for the result row to
// render "née …" / "· middle name …" hints — same as the existing née
// hint, these show whenever the field differs from display_name, regardless
// of which field was the actual reason for the match (simplest, and still
// useful context either way).
export function rankPeopleByName(people, query, limit = 10) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  return people
    .map((p) => {
      // birth_name is the canonical field; maiden_name is legacy seed data.
      const birthName = p.birth_name || p.maiden_name || '';
      const middleName = p.middle_name || '';
      const nameScore = scoreText(p.display_name, q);
      const birthScore = scoreText(birthName, q);
      const middleScore = scoreText(middleName, q);
      const score = Math.max(nameScore, birthScore, middleScore);
      return score > 0
        ? { ...p, _score: score, _birthName: birthName, _middleName: middleName }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b._score - a._score || a.display_name.localeCompare(b.display_name))
    .slice(0, limit);
}
