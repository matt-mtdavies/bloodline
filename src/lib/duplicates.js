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

function nameKey(p) {
  const parts = norm(p.display_name).split(' ').filter(Boolean);
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
