import { restrictionOf, factsHash } from './keepsake.js';
import { detectRegion, nearestWorldEvent } from './worldEvents.js';

/*
 * The Ancestry Story — pure data assembly for a person's "where you come
 * from" narrative: two ascending chains (the direct patrilineal line through
 * fathers, the direct matrilineal line through mothers), each traced back as
 * far as the tree actually records, converging at the subject's own parents'
 * marriage. Deliberately NOT the full ancestor tree (which doubles every
 * generation) — a single followable thread per side is what makes this a
 * story rather than a pedigree chart; the full pedigree is what the existing
 * chart/list views and GEDCOM export already serve.
 *
 * buildAncestryFacts(graph, personId) → {
 *   subject:     { name, gender }
 *   paternalLine: [ {..ancestor..}, ... ]   // oldest known ancestor first
 *   maternalLine: [ {..ancestor..}, ... ]   // oldest known ancestor first
 *   convergence: { year, place } | null     // the subject's own parents' marriage, if on record
 *   region:      string                      // detectRegion(graph), for historical grounding
 * } — or null when the subject is private (never generatable, same rule as
 * the Keepsake).
 *
 * House rules (same discipline as lib/keepsake.js):
 *   • never invent a date, place, or relationship not on record;
 *   • a private ancestor stops that line right there — excluded outright,
 *     and nothing behind them is revealed or implied;
 *   • a summary-visibility ancestor appears name-only, no facts;
 *   • an empty line (no further parent on record) is simply short — the
 *     story is honest about where the record runs out, never padded.
 */

const yearOf = (d) => {
  if (!d) return null;
  const m = String(d).match(/\d{4}/);
  return m ? m[0] : null;
};

// Same qualifier convention as graph.js's own isBioAdopt — an adoptive
// parent is a real ancestor for this purpose, a step-parent is not (there is
// no blood/legal-descent thread through a step relationship to narrate).
const isBioAdopt = (q) => !q || q === 'biological' || q === 'adoptive';

const MASC = new Set(['male', 'm', 'man']);
const FEM = new Set(['female', 'f', 'woman']);

// Walks strictly upward through one gender of bio/adoptive parent — the
// classic patrilineal (father→father's father→…) or matrilineal
// (mother→mother's mother→…) thread. Capped at a generous safety depth so a
// malformed/cyclic edge can never spin this loop forever; no real family
// tree should ever approach it.
const MAX_DEPTH = 20;

function walkLine(graph, startId, genderSet, region) {
  const out = [];
  let currentId = startId;
  const seen = new Set();
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const parents = graph.parents(currentId) || [];
    const next = parents.find((p) => {
      const person = graph.byId.get(p.id);
      return person && isBioAdopt(p.qualifier) && genderSet.has((person.gender || '').toLowerCase());
    });
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    const person = graph.byId.get(next.id);
    const restriction = restrictionOf(person);
    if (restriction === 'private') break; // excluded outright; the line stops here

    out.push(entryFor(person, restriction, region));
    if (restriction === 'summary') break; // named, but nothing behind them is knowable either
    currentId = next.id;
  }
  return out.reverse(); // oldest known ancestor first — the order the story is told in
}

function entryFor(person, restriction, region) {
  if (restriction === 'summary') {
    return { id: person.id, name: person.display_name, restricted: true };
  }
  const bornYear = yearOf(person.birth_date);
  const worldEvent = bornYear ? nearestWorldEvent(Number(bornYear), region) : null;
  return {
    id: person.id,
    name: person.display_name,
    gender: person.gender || null,
    born: { year: bornYear, place: person.birth_place || null },
    died: person.is_deceased ? { year: yearOf(person.death_date), place: null } : null,
    occupation: person.occupation || null,
    worldEvent: worldEvent ? { label: worldEvent.label, year: worldEvent.year } : null,
    restricted: false,
  };
}

// The subject's own parents' marriage, if the two are on record as partners
// — never invented, never assumed just because both parents are known.
function convergenceFor(graph, personId) {
  const parents = graph.parents(personId) || [];
  const father = parents.find((p) => {
    const person = graph.byId.get(p.id);
    return person && isBioAdopt(p.qualifier) && MASC.has((person.gender || '').toLowerCase());
  });
  const mother = parents.find((p) => {
    const person = graph.byId.get(p.id);
    return person && isBioAdopt(p.qualifier) && FEM.has((person.gender || '').toLowerCase());
  });
  if (!father || !mother) return null;
  const partner = (graph.partners(father.id) || []).find((p) => p.id === mother.id);
  if (!partner || !partner.is_married) return null;
  return { year: yearOf(partner.marriage_date), place: partner.marriage_place || null };
}

export function buildAncestryFacts(graph, personId) {
  const person = graph.byId.get(personId);
  if (!person || restrictionOf(person) === 'private') return null;

  const region = detectRegion(graph);
  return {
    subject: { name: person.display_name, gender: person.gender || null },
    paternalLine: walkLine(graph, personId, MASC, region),
    maternalLine: walkLine(graph, personId, FEM, region),
    convergence: convergenceFor(graph, personId),
    region,
  };
}

// A minimum bar for "is there enough to tell a real story" — thin enough
// that almost any tree with two recorded generations qualifies, but not a
// bare stub with only immediate parents and nothing behind them. Counts only
// non-restricted (fully known) ancestors — a name-only summary entry doesn't
// carry a tellable fact.
export const ANCESTRY_MIN_ANCESTORS = 3;

export function ancestryReady(facts) {
  if (!facts) return false;
  const known = (line) => line.filter((a) => !a.restricted).length;
  return known(facts.paternalLine) + known(facts.maternalLine) >= ANCESTRY_MIN_ANCESTORS;
}

export { factsHash };
