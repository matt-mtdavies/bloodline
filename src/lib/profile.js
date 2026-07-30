/*
 * Profile completeness — the engagement loop from the V2 brief.
 *
 * The profile is the destination, so we gently surface what's still missing:
 * a portrait, a few life events, the stories that make a person more than a
 * pair of dates. Pure client logic, no AI — it just looks at what's recorded.
 */
import { yearOf } from './dates.js';

export function profileCompleteness(person, graph, memoryCount = 0) {
  const hasRelation =
    graph.parents(person.id).length +
      graph.children(person.id).length +
      graph.partners(person.id).length +
      graph.siblings(person.id).length >
    0;

  const checks = [
    { key: 'Portrait', done: !!person.photo },
    { key: 'Biography', done: !!(person.bio && person.bio.trim()) },
    { key: 'Birth date', done: !!person.birth_date },
    { key: 'Birthplace', done: !!person.birth_place },
    { key: 'Occupation', done: !!person.occupation },
    { key: 'Tags', done: !!(person.tags && person.tags.length) },
    { key: 'Life events', done: !!(person.events && person.events.length) },
    { key: 'Memories', done: memoryCount > 0 },
    { key: 'Relationships', done: hasRelation },
  ];

  const done = checks.filter((c) => c.done).length;
  return {
    score: Math.round((done / checks.length) * 100),
    missing: checks.filter((c) => !c.done).map((c) => c.key),
    checks,
  };
}

/*
 * The key life events for the timeline. Stored events (person.events) are
 * merged with the ones we can always derive — born, passed — and sorted. We
 * never invent: an event only appears if the data is actually there.
 */
export function lifeEvents(person) {
  const events = [];
  if (person.birth_date) {
    events.push({
      year: yearOf(person.birth_date),
      title: 'Born',
      detail: person.birth_place || null,
    });
  }
  for (const e of person.events || []) {
    events.push({ year: String(e.year), title: e.title, detail: e.detail || null, tag: e.tag || null });
  }
  if (person.is_deceased && person.death_date) {
    events.push({ year: yearOf(person.death_date), title: 'Passed away', detail: person.cause_of_death || null });
  }
  return events
    .filter((e) => e.year)
    .sort((a, b) => Number(a.year) - Number(b.year));
}

function normalizeEventTitle(t) {
  return (t || '').trim().toLowerCase().replace(/[^a-z]/g, '');
}

function titlesLikelyMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // "Enlisted" vs "Enlisted/Began Service" — different documents often
  // phrase the same milestone slightly differently. A same-year, one-title-
  // contains-the-other match catches that without risking a false positive
  // on two genuinely distinct short titles.
  return (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b));
}

/*
 * True when a candidate document-extracted fact ({ year, title }) is an
 * obvious duplicate of something already on this profile — either the
 * derived Born/Passed-away entry, or a stored event with a matching year and
 * a clearly-the-same title. Deliberately conservative (exact year, near-
 * identical title): a busy document can legitimately produce several real,
 * distinct events that happen to share a year (admitted, diagnosed,
 * discharged, all in 1945), and those must never be silently dropped.
 */
export function isDuplicateLifeEvent(person, fact) {
  if (!fact?.year) return false;
  const factYear = String(fact.year);
  const factKey = normalizeEventTitle(fact.title);
  if (factKey === 'born' && person.birth_date && yearOf(person.birth_date) === factYear) return true;
  if ((factKey === 'passedaway' || factKey === 'died') && person.death_date && yearOf(person.death_date) === factYear) return true;
  return (person.events || []).some(
    (e) => String(e.year) === factYear && titlesLikelyMatch(normalizeEventTitle(e.title), factKey),
  );
}

function nameTokens(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3); // skip initials and short particles ("de", "OJ")
}

/*
 * True when this person already has a stored event, in the same year, whose
 * title or detail mentions the given name — a wider, name-based signal for
 * exactly the case isDuplicateLifeEvent's title-similarity check can miss: a
 * relationship-derived suggestion ("Welcomed Oliver — 2012") re-offered
 * because the user's own event for the same birth was phrased completely
 * differently ("Our son arrived", "Birth of Oliver at Cardiff"). Biased
 * toward suppressing rather than repeating — a rare false suppression just
 * means the user adds the row by hand; a repeated "haven't I already added
 * this?" suggestion erodes trust in the whole feature.
 */
export function hasEventMentioning(person, year, name) {
  if (!year || !name) return false;
  const yearStr = String(year);
  const tokens = nameTokens(name);
  if (!tokens.length) return false;
  return (person.events || []).some((e) => {
    if (String(e.year) !== yearStr) return false;
    const haystack = `${e.title || ''} ${e.detail || ''}`.toLowerCase();
    return tokens.some((t) => haystack.includes(t));
  });
}

/*
 * EditPersonSheet.jsx's quick "Resting place" box is a single free-text
 * field — the same shape as Birthplace/Lives in — sitting alongside the
 * richer cemetery/plot/suburb/state breakdown the dedicated Resting Place
 * profile section (RestingPlace.jsx) offers. Real feedback: people want to
 * jot it down while adding a person, not make a separate trip to that
 * section, but adding more detail there later shouldn't be undone by an
 * unrelated later save through this plain form.
 *
 * Extracted as a pure function (rather than inlined in the component) for
 * the same reason `hasUnsyncedContent`/`dedupeMergeImport` are — it decides
 * whether a save destroys or preserves existing data, so it gets its own
 * unit tests rather than only ever being exercised by clicking through the
 * UI. Returns an empty object when nothing should be touched — the caller
 * spreads the result into its save payload, so an empty object means the
 * `resting_place` key is omitted entirely, not set to any particular value
 * (a present-but-undefined key would still overwrite it — see
 * updatePerson's shallow `{...person, ...fields}` merge in store.js).
 */
export function buildRestingPlacePatch(isDeceased, quickText, existingRestingPlace) {
  if (!isDeceased) return { resting_place: null };
  const initial = (existingRestingPlace?.place || '').trim();
  const next = (quickText || '').trim();
  if (next === initial) return {}; // untouched — the common case, leave whatever's there alone
  if (!next) return { resting_place: null };
  // A shallow merge, never a wholesale replace: preserves any cemetery
  // name/plot/suburb/state/lat/lon already filled in via the dedicated
  // section — this box only ever represents `place`.
  return { resting_place: { ...(existingRestingPlace || {}), place: next } };
}
