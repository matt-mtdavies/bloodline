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
// tabular "record" register (years, titles) above it. A quote's fact is
// extracted against the DOCUMENT's own subject, but a letter or record can
// still say something about someone else the writer mentions (a brother, a
// mate) — out of context that reads as a fact about the profile it's shown
// on, which is misleading. Skips any fact a human has dismissed (`status:
// 'dismissed'`, set the same way as everywhere else document facts are
// reviewed — see MilitaryService.jsx's per-quote remove button), so a
// misattributed or unwanted quote can be permanently cleared; carries
// `docId`/`factIndex` so the caller can do that dismissing.
export function militaryQuotes(personDocs, max = 3) {
  const quotes = [];
  for (const doc of personDocs || []) {
    const facts = doc.extracted?.facts || [];
    facts.forEach((fact, factIndex) => {
      if (fact.tag !== 'military' || !fact.quote || fact.status === 'dismissed') return;
      quotes.push({ quote: fact.quote, docTitle: doc.title, year: fact.year || null, docId: doc.id, factIndex });
    });
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

// Branch/nation/service number/rank — real Person fields (written via the
// same document-field accept flow as occupation/birth_place/residence, see
// lib/enrich.js), not something derived from events or facts. `branch` is a
// closed vocabulary ('army' | 'navy' | 'air_force') so it can key an icon
// reliably; `nation` stays free text (see summarize.js's BRANCH_FIELD
// comment) since constraining it up front would mean enumerating every
// country before any of this ships.
export function militaryProfile(person) {
  return {
    branch: person?.military_branch || null,
    nation: person?.military_nation || null,
    serviceNumber: person?.military_service_number || null,
    rank: person?.military_rank || null,
  };
}

// Medals/honours — a growable list, appended one at a time via the same
// document-medal accept flow as everything else here (see lib/enrich.js,
// store.js's addMedal). Read-only display for now; no manual add/edit UI.
export function militaryMedals(person) {
  return person?.military_medals || [];
}

export function hasMilitaryService(person, personDocs) {
  return militaryEvents(person).length > 0
    || militaryDocuments(personDocs).length > 0
    || !!person?.military_branch
    || militaryMedals(person).length > 0;
}

// The AI narrative is offered only once there's enough real material to
// write from — otherwise a bare "Enlisted 1942" gets padded into paragraphs
// of filler. No cap on militaryQuotes here (Infinity), since this counts
// everything on record, not just the handful the pull-quotes UI displays.
export function canGenerateMilitaryStory(person, personDocs) {
  return militaryEvents(person).length + militaryQuotes(personDocs, Infinity).length >= 3;
}
