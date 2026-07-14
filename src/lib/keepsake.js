import { lifeEvents } from './profile.js';
import {
  hasMilitaryService,
  militaryEvents,
  militaryProfile,
  militaryMedals,
  militaryQuotes,
} from './military.js';

/*
 * The Keepsake — layer 0: pure data assembly (see docs/KEEPSAKE.md).
 *
 * buildKeepsake(graph, personId, extras) → {
 *   subject:   { id, name, photo, restricted },
 *   spreads:   [ { key, ...display data } ]   // ordered, inclusion-rule filtered
 *   facts:     { ... }                        // the compact AI fact sheet
 *   factsHash: string                         // regeneration key
 *   sparse:    bool                           // few optional spreads → show the invitation
 * }  — or null when the subject is private-visibility (never generatable).
 *
 * extras: { memories, photos, documents, activity, familyName } — the store's
 * arrays, passed in whole; everything here filters by person_id itself.
 *
 * House rules enforced at this layer so no component or prompt has to:
 *   • never invent — every field traces to a stored record;
 *   • privacy — private people are excluded outright, summary people are
 *     name-only, living minors are name + portrait with no facts;
 *   • empty sections are omitted, never rendered hollow.
 */

const yearOf = (d) => {
  if (!d) return null;
  const m = String(d).match(/\d{4}/);
  return m ? m[0] : null;
};

// 'private' | 'summary' | 'minor' | null — mirrors HoverCard's restriction
// logic so the Keepsake can never leak more than the hover preview does.
export function restrictionOf(person) {
  if (!person) return 'private';
  if ((person.visibility || 'full') === 'private') return 'private';
  if ((person.visibility || 'full') === 'summary') return 'summary';
  if (person.is_minor && !person.is_deceased) return 'minor';
  return null;
}

// A privacy-safe reference to a relative: null when they must not appear at
// all; otherwise the minimum the given restriction allows.
function personRef(person) {
  const r = restrictionOf(person);
  if (r === 'private') return null;
  return {
    id: person.id,
    name: person.display_name,
    photo: r === 'summary' ? null : person.photo || null,
    restricted: r !== null,
  };
}

const refs = (graph, list) =>
  list
    .map((x) => personRef(graph.byId.get(x.id)))
    .filter(Boolean);

// Stable content hash — same djb2-style pattern as insights' aggregatesHash,
// so "has anything this edition draws on changed?" is one string compare.
export function factsHash(facts) {
  const s = JSON.stringify(facts);
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return String(h);
}

/*
 * Split a life into 1–4 chronological chapters at fixed age boundaries
 * (childhood 0–17, early years 18–39, mid-life 40–64, later years 65+),
 * then merge event-empty chapters into their neighbour so no chapter
 * renders hollow. Pure; `nowYear` injectable for tests.
 *
 * events: lifeEvents() shape [{ year, title, detail }] — already sorted.
 * Returns [{ fromYear, toYear, label, events }] (label "1985–2003").
 */
export function chapterBoundaries(events, birthYear, deathYear, nowYear = new Date().getFullYear()) {
  const evs = (events || []).filter((e) => e.year).map((e) => ({ ...e, year: String(e.year) }));
  const by = birthYear ? Number(birthYear) : null;

  if (!by) {
    // No birth year — no age bands to cut against. One chapter per ~4 events,
    // capped at 3 chapters, split evenly.
    if (!evs.length) return [];
    const nChapters = Math.min(3, Math.max(1, Math.ceil(evs.length / 4)));
    const per = Math.ceil(evs.length / nChapters);
    const out = [];
    for (let i = 0; i < evs.length; i += per) {
      const slice = evs.slice(i, i + per);
      out.push({
        fromYear: Number(slice[0].year),
        toYear: Number(slice[slice.length - 1].year),
        label: slice[0].year === slice[slice.length - 1].year
          ? slice[0].year
          : `${slice[0].year}–${slice[slice.length - 1].year}`,
        events: slice,
      });
    }
    return out;
  }

  const endYear = deathYear ? Number(deathYear) : nowYear;
  const AGE_CUTS = [18, 40, 65];
  // Band year-ranges, clipped to the actual life span.
  const bands = [];
  let from = by;
  for (const cut of AGE_CUTS) {
    const to = by + cut - 1;
    if (from > endYear) break;
    bands.push({ fromYear: from, toYear: Math.min(to, endYear), events: [] });
    from = by + cut;
  }
  if (from <= endYear) bands.push({ fromYear: from, toYear: endYear, events: [] });

  for (const e of evs) {
    const y = Number(e.year);
    const band = bands.find((b) => y >= b.fromYear && y <= b.toYear)
      // Out-of-range years (pre-birth typo, posthumous honour) go to the
      // nearest end rather than being silently dropped.
      || (y < by ? bands[0] : bands[bands.length - 1]);
    if (band) band.events.push(e);
  }

  // Merge event-empty bands forward (into the next band), last one backward —
  // a chapter with nothing to tell isn't a chapter.
  const merged = [];
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (b.events.length === 0) {
      const next = bands[i + 1];
      if (next) { next.fromYear = b.fromYear; continue; }
      const prevOut = merged[merged.length - 1];
      if (prevOut) { prevOut.toYear = b.toYear; continue; }
      // An entirely event-less life still gets its single chapter.
    }
    merged.push(b);
  }
  return merged.map((b) => ({
    ...b,
    label: b.fromYear === b.toYear ? String(b.fromYear) : `${b.fromYear}–${b.toYear}`,
  }));
}

/*
 * The Family Constellation — a pure layout for the signature spread.
 * Subject at (0,0); ancestors above (negative y), descendants below,
 * partners beside, siblings on the subject's row, one unit apart. Hard cap
 * of MAX_NODES, filled closest-relationship-first, so a 500-person tree
 * can never dissolve the diagram into dust. Private people never appear.
 */
export const CONSTELLATION_MAX_NODES = 40;

export function constellationLayout(graph, personId) {
  const subject = graph.byId.get(personId);
  if (!subject) return { nodes: [], links: [] };

  const nodes = [];
  const links = [];
  const placed = new Map(); // id → node
  const add = (person, band, x, y) => {
    if (!person || placed.has(person.id)) return placed.get(person.id) || null;
    if (nodes.length >= CONSTELLATION_MAX_NODES) return null;
    const ref = personRef(person);
    if (!ref) return null; // private — excluded outright
    const node = { ...ref, band, x, y };
    nodes.push(node);
    placed.set(person.id, node);
    return node;
  };
  const link = (a, b, kind) => {
    if (!a || !b) return;
    links.push({ from: a.id, to: b.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, kind });
  };

  const me = add(subject, 'subject', 0, 0);
  if (!me) return { nodes: [], links: [] };

  // Priority order: partners, parents, children, siblings, grandparents,
  // grandchildren — nearest bonds win the cap.
  const partners = graph.partners(personId);
  partners.forEach((p, i) => {
    const n = add(graph.byId.get(p.id), 'partner', i + 1, 0);
    link(me, n, 'partner');
  });

  const parents = graph.parents(personId);
  parents.forEach((p, i) => {
    const n = add(graph.byId.get(p.id), 'parent', i - (parents.length - 1) / 2, -1);
    link(n, me, 'parent');
  });

  const children = graph.children(personId);
  children.forEach((c, i) => {
    const n = add(graph.byId.get(c.id), 'child', i - (children.length - 1) / 2, 1);
    link(me, n, 'parent');
  });

  const siblings = graph.siblings(personId);
  siblings.forEach((s, i) => {
    // Siblings fan out leftwards, past the subject; partners took the right.
    const n = add(graph.byId.get(s.id), 'sibling', -(i + 1), 0);
    // Tie each sibling to a shared placed parent when there is one, else to
    // the subject directly so no node floats unconnected.
    const shared = graph.parents(s.id).find((pp) => placed.has(pp.id));
    link(shared ? placed.get(shared.id) : me, n, 'parent');
  });

  // Grandparents: parents of placed parents.
  let gpSlot = 0;
  for (const p of parents) {
    const parentNode = placed.get(p.id);
    if (!parentNode) continue;
    for (const gp of graph.parents(p.id)) {
      const n = add(graph.byId.get(gp.id), 'grandparent', gpSlot++ - 1.5, -2);
      link(n, parentNode, 'parent');
    }
  }

  // Grandchildren: children of placed children.
  let gcSlot = 0;
  for (const c of children) {
    const childNode = placed.get(c.id);
    if (!childNode) continue;
    for (const gc of graph.children(c.id)) {
      const n = add(graph.byId.get(gc.id), 'grandchild', gcSlot++ - 1.5, 2);
      link(childNode, n, 'parent');
    }
  }

  return { nodes, links };
}

// ── Fact sheet for the AI (Phase 2's single structured call) ───────────────

export function buildKeepsakeFacts(graph, personId, extras = {}) {
  const person = graph.byId.get(personId);
  if (!person || restrictionOf(person) === 'private') return null;
  const { memories = [], documents = [] } = extras;

  const personDocs = documents.filter((d) => d.person_id === personId);
  const nameOnly = (list) => refs(graph, list).map((r) => r.name);

  return {
    subject: {
      name: person.display_name,
      givenNames: person.given_names || null,
      familyName: person.family_name || null,
      maidenName: person.maiden_name || null,
      gender: person.gender || null,
      born: { year: yearOf(person.birth_date), date: person.birth_date || null, place: person.birth_place || null },
      died: person.is_deceased
        ? { year: yearOf(person.death_date), date: person.death_date || null, cause: person.cause_of_death || null }
        : null,
      occupation: person.occupation || null,
      residence: person.residence || null,
      tags: person.tags || [],
      bio: person.bio || null,
    },
    events: lifeEvents(person),
    family: {
      parents: nameOnly(graph.parents(personId)),
      partners: graph.partners(personId)
        .map((p) => {
          const ref = personRef(graph.byId.get(p.id));
          return ref ? { name: ref.name, status: p.status || null, married: !!p.is_married, marriageYear: yearOf(p.marriage_date) } : null;
        })
        .filter(Boolean),
      siblings: nameOnly(graph.siblings(personId)),
      children: nameOnly(graph.children(personId)),
      grandchildren: dedupeGrandchildren(graph, personId).length,
    },
    memories: topMemories(memories, personId).map((m) => ({ text: m.text, author: m.author || m.authorName || null })),
    documents: personDocs.slice(0, 8).map((d) => ({
      title: d.title,
      summary: d.extracted?.summary || null,
      facts: (d.extracted?.facts || []).slice(0, 4).map((f) => ({ year: f.year || null, title: f.title || null })),
    })),
    military: hasMilitaryService(person, personDocs)
      ? {
          ...militaryProfile(person),
          events: militaryEvents(person),
          medals: militaryMedals(person).map((m) => m.name || m),
        }
      : null,
    places: placesOf(graph, person),
  };
}

// ── Spread assembly ─────────────────────────────────────────────────────────

function topMemories(memories, personId, cap = 6) {
  return memories
    .filter((m) => m.person_id === personId)
    .sort((a, b) => (b.votes || 0) - (a.votes || 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .slice(0, cap);
}

function dedupeGrandchildren(graph, personId) {
  const seen = new Set();
  for (const c of graph.children(personId)) {
    for (const gc of graph.children(c.id)) seen.add(gc.id);
  }
  return [...seen];
}

function placesOf(graph, person) {
  const out = [];
  const seen = new Set();
  const push = (place, role, year) => {
    const key = (place || '').trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ place: place.trim(), role, year: year || null });
  };
  push(person.birth_place, 'Born', yearOf(person.birth_date));
  for (const p of graph.partners(person.id)) {
    if (p.marriage_place) push(p.marriage_place, 'Married', yearOf(p.marriage_date));
  }
  push(person.residence, 'Lived', null);
  return out;
}

// Gendered kin-role words for the frontispiece line — same gender vocabulary
// the rest of the app uses (HoverCard's siblingWord etc.). Kin words ONLY:
// the occupation already leads the cover as the epithet, and folding it in
// here both duplicated it and mangled it — lowercasing user-entered text
// breaks "HR", "RAAF", "McDonald", and a job title like "Partner, HR
// Transformation" reads as a relationship right after "husband". It appears
// (case untouched) only as a fallback when someone has no kin roles at all,
// so the line is never empty.
function roleWords(graph, person) {
  const g = (person.gender || '').toLowerCase();
  const masc = ['male', 'm', 'man'].includes(g);
  const fem = ['female', 'f', 'woman'].includes(g);
  const words = [];
  const children = graph.children(person.id);
  if (children.length) words.push(masc ? 'father' : fem ? 'mother' : 'parent');
  if (dedupeGrandchildren(graph, person.id).length) words.push(masc ? 'grandfather' : fem ? 'grandmother' : 'grandparent');
  const married = graph.partners(person.id).some((p) => p.status === 'current' && p.is_married);
  if (married) words.push(masc ? 'husband' : fem ? 'wife' : 'partner');
  if (!words.length && person.occupation) words.push(person.occupation);
  return words;
}

function lifespanLine(person) {
  const b = yearOf(person.birth_date);
  const d = person.is_deceased ? yearOf(person.death_date) : null;
  if (b && d) return `${b} – ${d}`;
  if (b && person.is_deceased) return `${b} –`;
  if (b) return `b. ${b}`;
  return d ? `d. ${d}` : '';
}

export function keepsakeSpreads(graph, personId, extras = {}) {
  const person = graph.byId.get(personId);
  if (!person || restrictionOf(person) === 'private') return null;
  const { memories = [], photos = [], documents = [], activity = [], familyName = '' } = extras;

  const personDocs = documents.filter((d) => d.person_id === personId);
  const personPhotos = photos.filter((p) => p.person_id === personId);
  const events = lifeEvents(person);
  const parents = refs(graph, graph.parents(personId));
  const childrenRefs = refs(graph, graph.children(personId));
  const grandchildRefs = refs(
    graph,
    dedupeGrandchildren(graph, personId).map((id) => ({ id })),
  );
  const constellation = constellationLayout(graph, personId);
  const places = placesOf(graph, person);
  const voices = topMemories(memories, personId).map((m) => {
    const authorPerson = m.authorId ? graph.byId.get(m.authorId) : null;
    return {
      text: m.text,
      author: m.anonymous ? null : (m.author || m.authorName || authorPerson?.display_name || null),
      votes: m.votes || 0,
    };
  });

  const spreads = [];
  const push = (key, data) => spreads.push({ key, ...data });

  // 1 · Cover — always. epithet is the AI's once an edition exists; the
  // occupation stands in until then so the cover is never bare.
  push('cover', {
    name: person.display_name,
    photo: restrictionOf(person) === 'summary' ? null : person.photo || null,
    lifespan: lifespanLine(person),
    epithet: person.occupation || null,
  });

  // 2 · Frontispiece — always.
  push('frontispiece', {
    roles: roleWords(graph, person),
    familyName,
    recordCount: graph.people.length + memories.length + photos.length + documents.length,
  });

  // 3 · Origins — birth data or parents on record.
  if (person.birth_date || person.birth_place || parents.length) {
    push('origins', {
      born: { year: yearOf(person.birth_date), date: person.birth_date || null, place: person.birth_place || null },
      parents,
    });
  }

  // 4 · The Family Constellation — ≥3 relatives beyond the subject.
  if (constellation.nodes.length >= 4) {
    push('constellation', constellation);
  }

  // 5 · Chapters of a Life — ≥2 events or a bio to tell.
  if (events.length >= 2 || person.bio) {
    push('chapters', {
      bio: person.bio || null,
      chapters: chapterBoundaries(
        events,
        yearOf(person.birth_date),
        person.is_deceased ? yearOf(person.death_date) : null,
      ),
    });
  }

  // 6 · In Service — military on record.
  if (hasMilitaryService(person, personDocs)) {
    push('service', {
      profile: militaryProfile(person),
      events: militaryEvents(person),
      medals: militaryMedals(person),
      quotes: militaryQuotes(personDocs, 3),
    });
  }

  // 7 · The Places — ≥2 distinct places.
  if (places.length >= 2) push('places', { places });

  // 8 · Voices — ≥1 memory.
  if (voices.length >= 1) push('voices', { voices });

  // 9 · The Album — ≥2 photos.
  if (personPhotos.length >= 2) {
    push('album', {
      photos: personPhotos.slice(0, 8).map((p) => ({ src: p.src, caption: p.caption || '', date: p.date || '' })),
    });
  }

  // 10 · Documents of a Life — ≥1 document.
  if (personDocs.length >= 1) {
    push('documents', {
      documents: personDocs.slice(0, 6).map((d) => ({
        id: d.id,
        title: d.title,
        src: d.src,
        thumb: d.thumb || null,
        mime: d.mime || null,
        fact: d.extracted?.summary
          || ((d.extracted?.facts || [])[0] ? `${d.extracted.facts[0].year || ''} ${d.extracted.facts[0].title || ''}`.trim() : null),
      })),
    });
  }

  // 11 · The Record — always. Rows with nothing on record are skipped.
  const recordRows = [];
  const row = (label, value) => value && recordRows.push({ label, value });
  row('Born', [person.birth_date, person.birth_place].filter(Boolean).join(' · '));
  const marriages = graph.partners(personId)
    .map((p) => {
      const ref = personRef(graph.byId.get(p.id));
      if (!ref || !p.is_married) return null;
      return [ref.name, yearOf(p.marriage_date)].filter(Boolean).join(', ');
    })
    .filter(Boolean);
  row('Married', marriages.join('; '));
  row('Children', childrenRefs.map((c) => c.name).join(', '));
  row('Occupation', person.occupation);
  row('Resided', person.residence);
  const mil = militaryProfile(person);
  row('Service', [mil.rank, mil.branch ? mil.branch.replace('_', ' ') : null, mil.nation].filter(Boolean).join(', '));
  if (person.is_deceased) row('Died', person.death_date || 'Date unknown');
  push('record', { rows: recordRows });

  // 12 · Legacy — has descendants.
  if (childrenRefs.length) {
    const years = grandchildRefs
      .map((r) => yearOf(graph.byId.get(r.id)?.birth_date))
      .filter(Boolean)
      .map(Number);
    push('legacy', {
      children: childrenRefs,
      grandchildren: grandchildRefs,
      youngestYear: years.length ? Math.max(...years) : null,
      memorial: !!person.is_deceased,
    });
  }

  // 13 · Colophon — always.
  const contributors = [...new Set(activity.map((a) => a.authorName).filter(Boolean))];
  const optionalCount = spreads.filter((s) => !['cover', 'frontispiece', 'record', 'colophon'].includes(s.key)).length;
  push('colophon', {
    recordCount: graph.people.length + memories.length + photos.length + documents.length,
    contributors,
    familyName,
    sparse: optionalCount < 3,
  });

  return spreads;
}

/*
 * Fold a compiled edition's narrative (from /api/keepsake) into the spread
 * descriptors. Pure and forgiving: chapters match by index, surplus AI
 * chapters are ignored, and anything missing simply leaves that spread's
 * Phase-1 pending state in place — a stale or partial narrative can never
 * break the book.
 */
export function applyNarrative(spreads, narrative) {
  if (!narrative) return spreads;
  return spreads.map((s) => {
    if (s.key === 'cover' && narrative.epithet) {
      return { ...s, epithet: narrative.epithet };
    }
    if (s.key === 'origins' && narrative.origins?.length) {
      return { ...s, narrative: narrative.origins };
    }
    if (s.key === 'chapters' && narrative.chapters?.length) {
      return {
        ...s,
        chapters: s.chapters.map((ch, i) => {
          const n = narrative.chapters[i];
          return n
            ? { ...ch, narrativeTitle: n.title || null, paragraphs: n.paragraphs?.length ? n.paragraphs : null }
            : ch;
        }),
      };
    }
    if (s.key === 'legacy' && narrative.legacy?.length) {
      return { ...s, paragraphs: narrative.legacy };
    }
    return s;
  });
}

export function buildKeepsake(graph, personId, extras = {}) {
  const person = graph.byId.get(personId);
  if (!person || restrictionOf(person) === 'private') return null;
  const facts = buildKeepsakeFacts(graph, personId, extras);
  const spreads = keepsakeSpreads(graph, personId, extras);
  const colophon = spreads[spreads.length - 1];
  return {
    subject: personRef(person),
    spreads,
    facts,
    factsHash: factsHash(facts),
    sparse: !!colophon?.sparse,
  };
}
