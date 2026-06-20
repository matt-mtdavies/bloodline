/*
 * Profile completeness — the engagement loop from the V2 brief.
 *
 * The profile is the destination, so we gently surface what's still missing:
 * a portrait, a few life events, the stories that make a person more than a
 * pair of dates. Pure client logic, no AI — it just looks at what's recorded.
 */
import { yearOf } from './dates.js';

export function profileCompleteness(person, graph) {
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
    events.push({ year: String(e.year), title: e.title, detail: e.detail || null });
  }
  if (person.is_deceased && person.death_date) {
    events.push({ year: yearOf(person.death_date), title: 'Passed away', detail: null });
  }
  return events
    .filter((e) => e.year)
    .sort((a, b) => Number(a.year) - Number(b.year));
}
