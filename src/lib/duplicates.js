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
 * rule a pair out entirely.
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
 * Returns { people, relationships, skipped, updatedExisting } — the incoming
 * arrays with exact re-adds removed, a count of how many people were
 * collapsed, and a Map of existingId → merged person object for every
 * existing person a collapsed re-add contributed field data to (via
 * mergePersonFields, so a re-import can carry over Places Lived/Education/
 * military details the existing record was missing, rather than the
 * collapsed incoming record's own data being silently discarded).
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

  return { people: keptPeople, relationships: keptRels, skipped: newPeople.length - keptPeople.length - droppedIds.size, updatedExisting };
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
// rest ("places lived", not "place liveds").
const CHANGE_ARRAY_LABELS = {
  residences: ['place lived', 'places lived'],
  education: ['education record', 'education records'],
  military_medals: ['medal', 'medals'],
  events: ['life event', 'life events'],
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
  return {
    newPeople: result.people,
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
