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
 * Returns { people, relationships, skipped } — the incoming arrays with exact
 * re-adds removed, plus a count of how many people were collapsed.
 */
export function dedupeMergeImport(existingPeople = [], existingRelationships = [], newPeople = [], newRelationships = []) {
  const byKey = new Map(); // match key → [existing people with that key]
  for (const e of existingPeople) {
    const k = mergeMatchKey(e);
    if (!k) continue;
    if (byKey.has(k)) byKey.get(k).push(e);
    else byKey.set(k, [e]);
  }

  const remap = {}; // dropped incoming id → surviving existing id
  const keptPeople = [];
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
        continue; // drop this exact re-add
      }
    }
    keptPeople.push(np);
  }

  // Re-point incoming edges through the remap, then drop any that now duplicate
  // an edge already in the tree or another kept incoming edge.
  const edgeKey = (r) => `${r.type}|${r.from_person}|${r.to_person}`;
  const existingEdges = new Set(existingRelationships.map(edgeKey));
  const seen = new Set();
  const keptRels = [];
  for (const r of newRelationships) {
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

  return { people: keptPeople, relationships: keptRels, skipped: newPeople.length - keptPeople.length };
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
