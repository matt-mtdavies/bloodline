/*
 * Duplicate-person detection.
 *
 * Surfaces likely-duplicate pairs (the same person entered twice) so the user
 * can merge them. We deliberately keep precision high over recall — a false
 * "these are duplicates" suggestion erodes trust faster than a missed one.
 *
 * A pair is suggested when both people share the same first+last name AND there
 * is corroborating evidence (a shared relative, the same birth year, or one
 * being a thin stub record). People who are directly related (a parent/child or
 * partner edge between them) are never suggested — that's a Sr./Jr. or a couple
 * who happen to share a surname, not a duplicate. Conflicting known birth years
 * rule a pair out entirely — and so, per the same principle, does a conflicting
 * set of known RELATIVES: real report, with a screenshot — a thin, dateless
 * stub ("James Ransom", parents George/Dorothy, nothing else recorded) was
 * flagged against two completely different, fully-documented James Ransoms 71
 * years apart, purely because "one side is a thin stub" was, on its own,
 * treated as sufficient corroboration — with no check for whether anything
 * else recorded about them actually agreed. The stub signal itself is kept
 * (it's real and deliberate — it catches an auto-created placeholder next to
 * the real entry someone later filled in properly), but it can now be
 * OVERRIDDEN: if both people have at least one NAMED parent and none of those
 * names overlap at all, that's exactly as strong a disqualifier as a
 * mismatched birth year (biologically there are only ever two, same
 * reasoning). Conflicting partners/children are a softer signal in principle
 * — unlike parents, a person can genuinely have many across a life, and a
 * source record is often partial — but ruled out the same way here, matching
 * this file's own precision-over-recall stance: a person with a wife Sarah
 * and 8 children on one record and a wife Mariah/Jantge and 12 different
 * children on another is not a partially-recorded version of the same
 * family, it's a different person who happens to share a name. All three
 * conflict checks compare NORMALIZED first+last names (the same `nameKey`
 * every other match in this file already uses), not raw relationship ids —
 * two records for the same real relative never share an id (they're
 * different person rows), so an id-based check could never catch this at all.
 *
 * findDuplicatePairs(people, relationships)
 *   → [{ aId, bId, score, confidence: 'high'|'medium', reasons: string[] }]
 */

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Generational suffixes — stripped before taking the last token as the
// surname, or "John Smith Jr." (last token "jr.") never groups with a
// duplicate stub "John Smith" (last token "smith").
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

function nameKey(p) {
  const parts = norm(p.display_name).split(' ').filter(Boolean);
  while (parts.length > 2 && SUFFIXES.has(parts[parts.length - 1].replace(/\.+$/, ''))) {
    parts.pop();
  }
  if (!parts.length) return null;
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return first + '|' + last;
}

const yearOf = (p) => {
  const m = String(p?.birth_date || '').match(/\d{4}/);
  return m ? m[0] : null;
};

// A "thin" record — little more than a name. Two same-named people where one is
// a stub is a classic duplicate (an auto-created placeholder vs. the real entry).
const isStub = (p) => !p.birth_date && !p.photo && !p.bio && !(p.events || []).length;

export function findDuplicatePairs(people = [], relationships = []) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const parents = new Map(); // child → Set(parentIds)
  const children = new Map(); // parent → Set(childIds)
  const partners = new Map(); // person → Set(partnerIds)
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };
  for (const r of relationships) {
    if (r.type === 'parent') { add(children, r.from_person, r.to_person); add(parents, r.to_person, r.from_person); }
    else if (r.type === 'partner') { add(partners, r.from_person, r.to_person); add(partners, r.to_person, r.from_person); }
  }
  const get = (m, id) => m.get(id) || new Set();
  const directlyRelated = (a, b) =>
    get(parents, a).has(b) || get(children, a).has(b) || get(partners, a).has(b);
  const sharedCount = (m, a, b) => {
    let n = 0; const sa = get(m, a);
    for (const x of get(m, b)) if (sa.has(x)) n++;
    return n;
  };

  // The set of normalized (first|last) name keys for whoever's related to
  // `id` through relationship map `m` — id-based, not name-based, since two
  // records for the same real relative never share an id. Used only for
  // conflict detection below; unrelated to sharedCount's own id-overlap check.
  const relativeNameKeys = (m, id) => {
    const out = new Set();
    for (const relId of get(m, id)) {
      const person = byId.get(relId);
      const key = person && nameKey(person);
      if (key) out.add(key);
    }
    return out;
  };
  // True when both sides have at least one NAMED relative in this category
  // and none of those names overlap at all — real, known facts that
  // contradict each other, not merely an absence of shared evidence.
  const conflictingRelatives = (m, aId, bId) => {
    const na = relativeNameKeys(m, aId);
    const nb = relativeNameKeys(m, bId);
    if (!na.size || !nb.size) return false;
    for (const k of na) if (nb.has(k)) return false;
    return true;
  };

  // Group by name key so we only compare same-named people (cheap, not O(n²)).
  const groups = new Map();
  for (const p of people) {
    const key = nameKey(p);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const pairs = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (directlyRelated(a.id, b.id)) continue;
        const ya = yearOf(a), yb = yearOf(b);
        if (ya && yb && ya !== yb) continue; // different known birth years → different people
        // Same principle, extended to named relatives: two known, non-
        // overlapping parents/children/partners are real, specific evidence
        // of two different people, not two records of one — this is what
        // stops a thin stub from being flagged against every unrelated
        // same-named person purely for being thin (see this function's own
        // header comment for the real report that motivated it).
        if (conflictingRelatives(parents, a.id, b.id)) continue;
        if (conflictingRelatives(children, a.id, b.id)) continue;
        if (conflictingRelatives(partners, a.id, b.id)) continue;

        const reasons = ['Same name'];
        let score = 2;
        const sp = sharedCount(parents, a.id, b.id);
        const sc = sharedCount(children, a.id, b.id);
        const spr = sharedCount(partners, a.id, b.id);
        if (sp) { score += 2; reasons.push(`${sp} shared parent${sp > 1 ? 's' : ''}`); }
        if (sc) { score += 2; reasons.push(`${sc} shared child${sc > 1 ? 'ren' : ''}`); }
        if (spr) { score += 2; reasons.push('shared partner'); }
        if (ya && yb && ya === yb) { score += 1; reasons.push(`both born ${ya}`); }
        const eitherStub = isStub(a) || isStub(b);
        if (eitherStub) { score += 1; reasons.push('one has few details'); }

        // Need at least one corroborating signal beyond the name.
        const corroborated = sp || sc || spr || (ya && yb && ya === yb) || eitherStub;
        if (!corroborated) continue;

        pairs.push({
          aId: a.id,
          bId: b.id,
          score,
          confidence: score >= 5 ? 'high' : 'medium',
          reasons,
        });
      }
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  return pairs;
}

// Stable key for a pair regardless of order — used to remember dismissals.
export function pairKey(aId, bId) {
  return [aId, bId].sort().join('~');
}

// Match signature for cross-import dedup: suffix-stripped name + birth year.
// Only defined when BOTH are known — a nameless or dateless record is too weak
// to auto-merge and is left for the review sheet instead.
function mergeMatchKey(p) {
  const nk = nameKey(p);
  const yr = yearOf(p);
  return nk && yr ? nk + '|' + yr : null;
}

const fullDateOf = (p) => {
  const d = String(p?.birth_date || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};

// Shared by mergePeople (store.js, a manual duplicate merge via
// DuplicatesSheet) and dedupeMergeImport just below (an automatic
// exact-re-add collapse on GEDCOM/FamilySearch re-import) — the same
// fill-if-blank-scalar + concat-array rule, so there's exactly one place
// that decides what surviving a merge actually means, not two drifting
// copies. `keep` wins on any real scalar conflict; `drop`'s data is
// otherwise carried forward rather than discarded, which is the fix for a
// real report: both call sites used to (or, for dedupeMergeImport, still
// did until this function existed) silently lose Places Lived / Education
// History / military details whenever they only existed on the side that
// didn't survive.
const SCALAR_FILLABLE = [
  'photo', 'photo_thumb', 'birth_date', 'death_date', 'cause_of_death', 'birth_place', 'residence',
  'occupation', 'bio', 'gender', 'given_names', 'middle_name', 'family_name',
  'birth_name', 'email', 'phone', 'story',
  'military_branch', 'military_nation', 'military_rank', 'military_service_number',
];
const ARRAY_CONCAT_FIELDS = ['events', 'conditions', 'residences', 'education', 'military_medals'];

// Content-based dedup keys for the array fields above — ignores each item's
// own generated `id` (keep and drop always mint independent ids, so an id
// comparison would never match anything) and instead keys on what the entry
// actually SAYS. This matters most for dedupeMergeImport: a one-off manual
// merge of two duplicate PERSON records only ever runs once, so blind
// concatenation was harmless there, but a repeatable "re-import an updated
// export" workflow calls mergePersonFields again on every re-import — without
// this, the same residence/education/military entry would silently double
// (then triple, ...) every time the same source data was re-imported.
// `norm` (name-normalization helper above) doubles as a fine text-dedup key.
const ARRAY_DEDUPE_KEYS = {
  residences: (r) => `${norm(r.place)}|${r.from_year ?? ''}|${r.to_year ?? ''}`,
  education: (e) => `${norm(e.institution)}|${e.from_year ?? ''}|${e.to_year ?? ''}`,
  military_medals: (m) => `${norm(m.name)}|${norm(m.detail)}`,
  events: (e) => `${e.year ?? ''}|${norm(e.title)}|${e.tag ?? ''}`,
  conditions: (c) => `${norm(c.name)}|${c.onset_year ?? ''}`,
};

function dedupeByKey(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function mergePersonFields(keep, drop) {
  const merged = { ...keep };
  for (const f of SCALAR_FILLABLE) {
    if (merged[f] == null || merged[f] === '') merged[f] = drop[f] ?? merged[f] ?? null;
  }
  // resting_place is a single object (cemetery/plot/place/...), not a plain
  // scalar or an array — same fill-if-blank rule as the scalars above, just
  // applied to the record as a whole rather than per-property.
  if (!merged.resting_place?.place && drop.resting_place?.place) {
    merged.resting_place = drop.resting_place;
  }
  merged.tags = [...new Set([...(keep.tags || []), ...(drop.tags || [])])];
  for (const f of ARRAY_CONCAT_FIELDS) {
    const combined = [...(keep[f] || []), ...(drop[f] || [])];
    merged[f] = ARRAY_DEDUPE_KEYS[f] ? dedupeByKey(combined, ARRAY_DEDUPE_KEYS[f]) : combined;
  }
  if (drop.is_deceased && !keep.is_deceased) {
    merged.is_deceased = true;
    merged.is_living = false;
    if (!merged.death_date) merged.death_date = drop.death_date || null;
  }
  return merged;
}

/*
 * De-duplicate an incoming (merge) import against the existing tree, so that
 * re-importing the same GEDCOM/FamilySearch data doesn't silently double the
 * whole tree. An incoming person is treated as the SAME as an existing one
 * when they share name + birth year AND don't have conflicting full dates;
 * that incoming person is dropped and its relationships are re-pointed at the
 * existing id (then any edge that now duplicates one already in the tree — or
 * another kept incoming edge — is dropped too).
 *
 * Deliberately conservative, matching findDuplicatePairs' precision-over-recall
 * stance: an AMBIGUOUS signature (more than one existing person with the same
 * name+year), a record with no birth year, or a genuine full-date conflict is
 * NOT auto-merged — it imports as new and the existing "Possible duplicates"
 * review sheet handles it. So this only ever collapses confident, unambiguous
 * re-adds; it never guesses. Pure; unit-tested.
 *
 * Two optional opts let a caller apply only PART of what this would
 * otherwise do — the granular-review case: "don't add these few new people,
 * and don't let these few existing people pick up new facts, but still
 * import everything else exactly as normal."
 *   - `skipPeople` (Set of incoming ids): a genuinely-new person in this set
 *     is dropped entirely, as if they weren't in the file — and so is any
 *     relationship edge that references them (an edge can't point at a
 *     person that was never added).
 *   - `skipEnrichmentFor` (Set of EXISTING person ids): a collapsed re-add
 *     whose survivor is in this set still collapses normally — no duplicate
 *     person is created, and its relationships still resolve onto the
 *     existing id exactly as always — it just never calls mergePersonFields,
 *     so none of ITS extra facts get written onto that existing record.
 *     Deduping (not creating a duplicate person) and enriching (writing new
 *     facts onto the survivor) are separable, and this is what makes them
 *     separable.
 *
 * Returns { people, relationships, skipped, updatedExisting, remap } — the
 * incoming arrays with exact re-adds removed, a count of how many people
 * were collapsed, a Map of existingId → merged person object for every
 * existing person a collapsed re-add contributed field data to (via
 * mergePersonFields, so a re-import can carry over Places Lived/Education/
 * military details the existing record was missing, rather than the
 * collapsed incoming record's own data being silently discarded), and the
 * raw incoming-id → existing-id collapse map itself (consumed by
 * findLikelyExistingMatches below, to trace a still-"new" person's incoming
 * relationships through to whichever existing people their relatives
 * already resolved to).
 */
export function dedupeMergeImport(existingPeople = [], existingRelationships = [], newPeople = [], newRelationships = [], opts = {}) {
  const { skipPeople = new Set(), skipEnrichmentFor = new Set() } = opts;
  const byKey = new Map(); // match key → [existing people with that key]
  for (const e of existingPeople) {
    const k = mergeMatchKey(e);
    if (!k) continue;
    if (byKey.has(k)) byKey.get(k).push(e);
    else byKey.set(k, [e]);
  }

  const remap = {}; // dropped incoming id → surviving existing id
  const updatedExisting = new Map(); // existing id → merged person object
  const keptPeople = [];
  const droppedIds = new Set(); // fully-excluded incoming ids — their edges must be dropped, not remapped
  for (const np of newPeople) {
    const k = mergeMatchKey(np);
    const matches = k ? byKey.get(k) : null;
    // Only collapse on an UNAMBIGUOUS match (exactly one existing person with
    // that name+year) whose full date, if both carry one, agrees.
    if (matches && matches.length === 1) {
      const e = matches[0];
      const fd1 = fullDateOf(np), fd2 = fullDateOf(e);
      if (!(fd1 && fd2 && fd1 !== fd2)) {
        remap[np.id] = e.id;
        if (!skipEnrichmentFor.has(e.id)) {
          const base = updatedExisting.get(e.id) || e;
          updatedExisting.set(e.id, mergePersonFields(base, np));
        }
        continue; // drop this exact re-add
      }
    }
    if (skipPeople.has(np.id)) {
      droppedIds.add(np.id);
      continue; // fully excluded — not added, and not merged into anyone
    }
    keptPeople.push(np);
  }

  // Re-point incoming edges through the remap, drop any edge that references
  // a fully-excluded person (neither endpoint exists to link), then drop any
  // that now duplicates an edge already in the tree or another kept edge.
  const edgeKey = (r) => `${r.type}|${r.from_person}|${r.to_person}`;
  const existingEdges = new Set(existingRelationships.map(edgeKey));
  const seen = new Set();
  const keptRels = [];
  for (const r of newRelationships) {
    if (droppedIds.has(r.from_person) || droppedIds.has(r.to_person)) continue;
    const mapped = {
      ...r,
      from_person: remap[r.from_person] || r.from_person,
      to_person: remap[r.to_person] || r.to_person,
    };
    const key = edgeKey(mapped);
    if (existingEdges.has(key) || seen.has(key)) continue;
    seen.add(key);
    keptRels.push(mapped);
  }

  return { people: keptPeople, relationships: keptRels, skipped: newPeople.length - keptPeople.length - droppedIds.size, updatedExisting, remap };
}

/*
 * Real report: a delta re-import proposed 81 "new" people who, checked
 * directly against production data, turned out to already be in the tree —
 * several with real birth dates recorded THERE, but none in the freshly
 * re-exported GEDCOM (Ancestry's export commonly omits birth dates for
 * living people, for privacy). dedupeMergeImport's own match key needs a
 * birth year on BOTH sides, so a person the source can structurally never
 * supply one for will read as "new" on every single re-import, forever.
 *
 * This is a second, independent signal for exactly that gap — the same
 * relationship-based corroboration findDuplicatePairs already uses (a
 * shared parent/child/partner), rather than a shared birth year: for each
 * still-"new" person, walk their relationships in the INCOMING batch; for
 * any relative who DID resolve to an existing person (via dedupeMergeImport's
 * own remap — i.e., that relative matched cleanly by name+year), check
 * whether that existing person already has a same-kind relationship to
 * someone with the exact same name. If so, that's real, specific evidence
 * this "new" person is likely the same as that existing one.
 *
 * Deliberately still never auto-merges anything (single-hop only, no
 * transitive chase, and requires an exact name match on top of the
 * relationship link) — this only flags a SUGGESTION for a human to confirm
 * or override, same precision-over-recall stance as everywhere else in this
 * file. Pure; unit-tested.
 *
 * Returns a Map<incomingPersonId, { id, name, reason }> — existing person id
 * + display name + a short human reason, for whichever "new" people got a
 * hit.
 */
export function findLikelyExistingMatches(existingPeople = [], existingRelationships = [], newRelationships = [], remap = {}, candidatePeople = []) {
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };

  const existingParents = new Map();  // child → Set(parent)   [existing ids]
  const existingChildren = new Map(); // parent → Set(child)   [existing ids]
  const existingPartners = new Map(); // person → Set(partner) [existing ids]
  for (const r of existingRelationships) {
    if (r.type === 'parent') { add(existingChildren, r.from_person, r.to_person); add(existingParents, r.to_person, r.from_person); }
    else if (r.type === 'partner') { add(existingPartners, r.from_person, r.to_person); add(existingPartners, r.to_person, r.from_person); }
  }
  const existingById = new Map(existingPeople.map((p) => [p.id, p]));

  const incomingParentsOf = new Map();  // child → Set(parent)   [incoming ids]
  const incomingChildrenOf = new Map(); // parent → Set(child)   [incoming ids]
  const incomingPartnersOf = new Map(); // person → Set(partner) [incoming ids]
  for (const r of newRelationships) {
    if (r.type === 'parent') { add(incomingChildrenOf, r.from_person, r.to_person); add(incomingParentsOf, r.to_person, r.from_person); }
    else if (r.type === 'partner') { add(incomingPartnersOf, r.from_person, r.to_person); add(incomingPartnersOf, r.to_person, r.from_person); }
  }

  const findViaRelatives = (relatedIncomingIds, existingSideMap, key) => {
    if (!relatedIncomingIds) return null;
    for (const q of relatedIncomingIds) {
      const eq = remap[q];
      if (!eq) continue;
      const candidates = existingSideMap.get(eq);
      if (!candidates) continue;
      for (const cid of candidates) {
        const cPerson = existingById.get(cid);
        if (cPerson && nameKey(cPerson) === key) return cPerson;
      }
    }
    return null;
  };

  const results = new Map();
  for (const p of candidatePeople) {
    const key = nameKey(p);
    if (!key) continue;

    const match =
      findViaRelatives(incomingParentsOf.get(p.id), existingChildren, key)
      ?? findViaRelatives(incomingChildrenOf.get(p.id), existingParents, key)
      ?? findViaRelatives(incomingPartnersOf.get(p.id), existingPartners, key);

    if (match) {
      results.set(p.id, { id: match.id, name: match.display_name, reason: 'shares a close relative already matched in your tree' });
    }
  }
  return results;
}

// Friendly per-field/array labels for describeMergeChanges below — deliberately
// a curated subset of SCALAR_FILLABLE/ARRAY_CONCAT_FIELDS, not every one of
// them: internal name-decomposition fields (given_names/middle_name/
// family_name), photo_thumb (a derived copy of `photo`), and contact fields
// (email/phone) aren't the kind of thing worth narrating in a "what's new"
// summary — a GEDCOM import rarely touches them, and surfacing them would be
// noise, not signal, for the one thing a delta-import review screen actually
// needs to answer: "what did I gain from this file?"
const CHANGE_FIELD_LABELS = {
  photo: 'photo', birth_date: 'birth date', death_date: 'death date', cause_of_death: 'cause of death',
  birth_place: 'birth place', residence: 'residence', occupation: 'occupation', bio: 'biography',
  birth_name: 'birth name',
  military_branch: 'military branch', military_nation: 'military nation',
  military_rank: 'military rank', military_service_number: 'service number',
};
// [singular, plural] — "place lived" doesn't pluralize by suffix like the
// rest ("places lived", not "place liveds"). `events` is handled separately
// below, not through this generic loop — see describeMergeChanges.
const CHANGE_ARRAY_LABELS = {
  residences: ['place lived', 'places lived'],
  education: ['education record', 'education records'],
  military_medals: ['medal', 'medals'],
  conditions: ['health record', 'health records'],
};

// Human-readable summary of what a merge added to an existing person —
// "birth place added", "+2 places lived" — for a delta-import review screen
// to show someone BEFORE they commit, not just a bare "34 people updated"
// count. Pure; takes the person before and after mergePersonFields.
export function describeMergeChanges(before, after) {
  const changes = [];
  for (const [field, label] of Object.entries(CHANGE_FIELD_LABELS)) {
    const wasBlank = before?.[field] == null || before?.[field] === '';
    const nowSet = after?.[field] != null && after?.[field] !== '';
    if (wasBlank && nowSet) changes.push(`${label} added`);
  }
  if (!before?.resting_place?.place && after?.resting_place?.place) changes.push('burial place added');
  for (const [field, [singular, plural]] of Object.entries(CHANGE_ARRAY_LABELS)) {
    const n = (after?.[field]?.length || 0) - (before?.[field]?.length || 0);
    if (n > 0) changes.push(`+${n} ${n === 1 ? singular : plural}`);
  }
  // events[] is split by tag rather than reported as one generic count — a
  // real user report on a GEDCOM's two _MILT-tagged records ("I don't see
  // any military additions") turned out to be exactly this: they WERE
  // there, just indistinguishable from an ordinary life event in the
  // summary. mergePersonFields' array-dedup always keeps `before`'s own
  // entries as an unchanged prefix (dedupeByKey never reorders, and ties
  // resolve to the first/keep occurrence), so the newly-added entries are
  // reliably exactly the tail past `before`'s own length — no need to
  // recompute a full diff.
  const newEvents = (after?.events || []).slice((before?.events || []).length);
  const newMilitary = newEvents.filter((e) => e.tag === 'military').length;
  const newOther = newEvents.length - newMilitary;
  if (newMilitary > 0) changes.push(`+${newMilitary} military record${newMilitary === 1 ? '' : 's'}`);
  if (newOther > 0) changes.push(`+${newOther} life event${newOther === 1 ? '' : 's'}`);
  return changes;
}

// Everything a delta-import review screen needs to show BEFORE committing —
// wraps dedupeMergeImport (the actual merge logic) with a human-facing
// summary, so "Update from file" can say what will happen rather than just
// doing it. Pure; nothing here writes to the tree — the caller still passes
// dedupeMergeImport's own people/relationships/updatedExisting on to
// importFromGedcom (store.js) to actually commit, exactly as today.
export function summarizeMergeImport(existingPeople, existingRelationships, newPeople, newRelationships) {
  const result = dedupeMergeImport(existingPeople, existingRelationships, newPeople, newRelationships);
  const byId = new Map(existingPeople.map((p) => [p.id, p]));
  const enrichedPeople = [];
  for (const [id, after] of result.updatedExisting) {
    const before = byId.get(id);
    const changes = describeMergeChanges(before, after);
    if (changes.length) enrichedPeople.push({ id, name: after.display_name, changes });
  }
  // A collapsed re-add that contributed nothing new (identical to what's
  // already on record) is a true no-op — not "new," not "enriched," just
  // correctly recognized as already-known. Surfacing it as a third bucket
  // (rather than silently folding it into "enriched") is what makes a
  // re-import of an unchanged file honestly say "nothing new here."
  const unchangedCount = result.skipped - enrichedPeople.length;
  // Some "new" people are only new because the source couldn't supply a
  // birth year for them (most commonly living relatives, redacted by the
  // export itself) — dedupeMergeImport's own match key needs one on both
  // sides, so it can never recognize them, no matter how many times the
  // same file is re-imported. This is a second signal via relationships
  // rather than dates — see findLikelyExistingMatches' own doc comment.
  const likelyExisting = findLikelyExistingMatches(existingPeople, existingRelationships, newRelationships, result.remap, result.people);
  return {
    newPeople: result.people.map((p) => ({ ...p, _likelyExisting: likelyExisting.get(p.id) || null })),
    newRelationshipCount: result.relationships.length,
    enrichedPeople,
    unchangedCount,
    raw: result,
  };
}

// Dismissed-pair tracking lives here (not inside DuplicatesSheet) so the
// review sheet and the topbar's count pill — two separate call sites — read
// the exact same set. It's a viewer-local "don't ask again", not family
// data, so plain localStorage rather than the synced tree store is enough.
const DISMISS_KEY = 'bl_dup_dismissed';

export function loadDismissedDuplicates() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); }
  catch { return new Set(); }
}

export function saveDismissedDuplicates(set) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}
