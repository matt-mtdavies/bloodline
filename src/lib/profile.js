/*
 * Profile completeness — the engagement loop from the V2 brief.
 *
 * The profile is the destination, so we gently surface what's still missing:
 * a portrait, a few life events, the stories that make a person more than a
 * pair of dates. Pure client logic, no AI — it just looks at what's recorded.
 */
import { yearOf } from './dates.js';

// Compose a person's full formal name, weaving a stored middle name in before
// the surname. The everyday display_name is what the tree and lists use; this
// is the fuller name shown on the profile heading when a middle name is set.
export function fullName(person) {
  if (!person) return '';
  const display = (person.display_name || '').trim();
  const middle = (person.middle_name || '').trim();
  if (!middle) return display;
  // Don't duplicate a middle name that's already part of the display name.
  if (display.toLowerCase().includes(middle.toLowerCase())) return display;
  const parts = display.split(/\s+/);
  if (parts.length < 2) return `${display} ${middle}`.trim();
  // Insert before the final (family-name) token: "Colin Ransom" → "Colin James Ransom".
  return [...parts.slice(0, -1), middle, parts[parts.length - 1]].join(' ');
}

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
