/*
 * Military Service — a specialized lens on data the app already collects,
 * not a new data model. A life event earns a "military" tag today when it's
 * added through the timeline editor or accepted from an AI document
 * extraction (see lib/profile.js / TimelineEditor.jsx); a document fact
 * earns one the same way an AI summary tags it (see documents/summarize.js).
 * Every function here just filters and shapes what's already on record —
 * the section itself only appears when there's something real to show
 * (see hasMilitaryService), same house rule as everywhere else: never
 * invent, only surface.
 */

// Events tagged 'military' (person.events), oldest first — the raw material
// for the record strip and the campaign-route waypoints.
export function militaryEvents(person) {
  return (person?.events || [])
    .filter((e) => e.tag === 'military' && e.year)
    .map((e) => ({ year: String(e.year), title: e.title, detail: e.detail || null }))
    .sort((a, b) => Number(a.year) - Number(b.year));
}

// Documents whose AI-extracted facts include at least one 'military' tag.
// Takes an already person- and privacy-scoped document list (personDocs from
// PersonSheet) rather than re-filtering by person_id itself, so it never
// bypasses whatever visibility restriction the caller already applied.
export function militaryDocuments(personDocs) {
  return (personDocs || []).filter((d) =>
    (d.extracted?.facts || []).some((f) => f.tag === 'military'),
  );
}

// Verbatim quotes from military-tagged facts, oldest-dated first, capped —
// "the story" register: the human/document voice, contrasted against the
// tabular "record" register (years, titles) above it.
export function militaryQuotes(personDocs, max = 3) {
  const quotes = [];
  for (const doc of personDocs || []) {
    for (const fact of doc.extracted?.facts || []) {
      if (fact.tag !== 'military' || !fact.quote) continue;
      quotes.push({ quote: fact.quote, docTitle: doc.title, year: fact.year || null });
    }
  }
  return quotes
    .sort((a, b) => (Number(a.year) || 0) - (Number(b.year) || 0))
    .slice(0, max);
}

// A single year, or a "1942–1946" span — never a guess, just the earliest
// and latest year actually recorded among the military-tagged events.
export function serviceYears(events) {
  const years = (events || []).map((e) => Number(e.year)).filter((n) => !Number.isNaN(n));
  if (!years.length) return null;
  const lo = Math.min(...years), hi = Math.max(...years);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

export function hasMilitaryService(person, personDocs) {
  return militaryEvents(person).length > 0 || militaryDocuments(personDocs).length > 0;
}

// The AI narrative is offered only once there's enough real material to
// write from — otherwise a bare "Enlisted 1942" gets padded into paragraphs
// of filler. No cap on militaryQuotes here (Infinity), since this counts
// everything on record, not just the handful the pull-quotes UI displays.
export function canGenerateMilitaryStory(person, personDocs) {
  return militaryEvents(person).length + militaryQuotes(personDocs, Infinity).length >= 3;
}
